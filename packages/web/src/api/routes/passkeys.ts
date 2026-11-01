import { ORPCError } from "@orpc/server";
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse, type RegistrationResponseJSON, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database";
import * as s from "../database/schema";
import { authed } from "../middleware/auth";
import { consumeLimit } from "../security/controls";
import { approvedFingerprint } from "../security/step-up";
import { operationHash } from "../../shared/operation-proof";
function target() { const url=new URL(process.env.WEBSITE_URL!); if(url.protocol!=="https:"&&url.hostname!=="localhost") throw new Error("HTTPS required"); return {rpID:url.hostname,origin:url.origin}; }
async function limit(uid:string) {
 const ok=await db.transaction(tx=>consumeLimit(tx,`passkey:${uid}`,1,30,60_000));
 if(!ok) throw new ORPCError("TOO_MANY_REQUESTS");
 await db.delete(s.securityChallenge).where(and(eq(s.securityChallenge.userId,uid),lt(s.securityChallenge.expiresAtMs,Date.now())));
 await db.delete(s.stepUpTicket).where(and(eq(s.stepUpTicket.userId,uid),lt(s.stepUpTicket.expiresAtMs,Date.now())));
}
async function take(uid:string,sid:string,id:string,kind:string) {
 const [row]=await db.delete(s.securityChallenge).where(and(eq(s.securityChallenge.id,id),eq(s.securityChallenge.userId,uid),eq(s.securityChallenge.sessionId,sid),eq(s.securityChallenge.kind,kind),gt(s.securityChallenge.expiresAtMs,Date.now()))).returning();
 if(!row) throw new ORPCError("UNAUTHORIZED");return row;
}
async function approved(row:typeof s.passkeyCredential.$inferSelect) {return approvedFingerprint(await operationHash({userId:row.userId,id:row.id,publicKey:row.publicKey}));}
const actions=z.enum(["device:register","device:revoke","device:unrevoke","device:remove","vault:create","vault:rekey","vault:erase","write-key:register"]);
export const passkeys={
 list:authed.handler(async({context})=>Promise.all((await db.select().from(s.passkeyCredential).where(eq(s.passkeyCredential.userId,context.user.id))).map(async r=>({id:r.id,fingerprint:r.fingerprint,createdAtMs:r.createdAtMs,approved:await approved(r)})))),
 registrationOptions:authed.handler(async({context})=>{
  const uid=context.user.id;await limit(uid);const rows=await db.select().from(s.passkeyCredential).where(eq(s.passkeyCredential.userId,uid));
  if(rows.length>=5)throw new ORPCError("FORBIDDEN",{message:"登録候補は5件までです。管理者による候補の整理が必要です"});
  const options=await generateRegistrationOptions({rpName:"Cockpit",rpID:target().rpID,userName:context.user.email,userID:new TextEncoder().encode(uid),attestationType:"none",authenticatorSelection:{residentKey:"preferred",userVerification:"required"},excludeCredentials:rows.map(r=>({id:r.id}))});
  const id=crypto.randomUUID();await db.insert(s.securityChallenge).values({id,userId:uid,sessionId:context.session.id,kind:"register",challenge:options.challenge,action:"",payloadHash:"",expiresAtMs:Date.now()+300000});return {id,options};
 }),
 register:authed.input(z.object({id:z.string().uuid(),response:z.unknown()})).handler(async({context,input})=>{
  await limit(context.user.id);const row=await take(context.user.id,context.session.id,input.id,"register");const t=target();
  let result;try{result=await verifyRegistrationResponse({response:input.response as RegistrationResponseJSON,expectedChallenge:row.challenge,expectedOrigin:t.origin,expectedRPID:t.rpID,requireUserVerification:true});}catch{throw new ORPCError("UNAUTHORIZED");}
  if(!result.verified||!result.registrationInfo)throw new ORPCError("UNAUTHORIZED");
  const c=result.registrationInfo.credential;const publicKey=Buffer.from(c.publicKey).toString("base64");const fingerprint=await operationHash({userId:context.user.id,id:c.id,publicKey});
  await db.transaction(async tx=>{const [n]=await tx.select({n:sql<number>`count(*)`}).from(s.passkeyCredential).where(eq(s.passkeyCredential.userId,context.user.id));if(n.n>=5)throw new ORPCError("FORBIDDEN");await tx.insert(s.passkeyCredential).values({id:c.id,userId:context.user.id,publicKey,counter:c.counter,fingerprint,createdAtMs:Date.now()});});
  return {fingerprint,approved:false};
 }),
 authenticationOptions:authed.input(z.object({action:actions,payloadHash:z.string().regex(/^[0-9a-f]{64}$/)})).handler(async({context,input})=>{
  await limit(context.user.id);const rows=await db.select().from(s.passkeyCredential).where(eq(s.passkeyCredential.userId,context.user.id));const usable=[];
  for(const r of rows)if(await approved(r))usable.push(r);
  if(!usable.length)throw new ORPCError("FORBIDDEN",{message:"承認済みのパスキーがありません。登録後、管理者が照合番号を別途確認する必要があります"});
  const options=await generateAuthenticationOptions({rpID:target().rpID,userVerification:"required",allowCredentials:usable.map(r=>({id:r.id}))});const id=crypto.randomUUID();
  await db.insert(s.securityChallenge).values({id,userId:context.user.id,sessionId:context.session.id,kind:"authenticate",challenge:options.challenge,action:input.action,payloadHash:input.payloadHash,expiresAtMs:Date.now()+300000});return {id,options};
 }),
 authenticate:authed.input(z.object({id:z.string().uuid(),response:z.unknown()})).handler(async({context,input})=>{
  await limit(context.user.id);const row=await take(context.user.id,context.session.id,input.id,"authenticate");const response=input.response as AuthenticationResponseJSON;
  if(!response||typeof response.id!=="string")throw new ORPCError("UNAUTHORIZED");
  const [c]=await db.select().from(s.passkeyCredential).where(and(eq(s.passkeyCredential.userId,context.user.id),eq(s.passkeyCredential.id,response.id)));
  if(!c||!await approved(c))throw new ORPCError("UNAUTHORIZED");const t=target();let result;
  try{result=await verifyAuthenticationResponse({response,expectedChallenge:row.challenge,expectedOrigin:t.origin,expectedRPID:t.rpID,requireUserVerification:true,credential:{id:c.id,publicKey:new Uint8Array(Buffer.from(c.publicKey,"base64")),counter:c.counter}});}catch{throw new ORPCError("UNAUTHORIZED");}
  if(!result.verified)throw new ORPCError("UNAUTHORIZED");const id=crypto.randomUUID();
  await db.transaction(async tx=>{const updated=await tx.update(s.passkeyCredential).set({counter:result.authenticationInfo.newCounter}).where(and(eq(s.passkeyCredential.id,c.id),eq(s.passkeyCredential.counter,c.counter))).returning();if(updated.length!==1)throw new ORPCError("CONFLICT");await tx.insert(s.stepUpTicket).values({id,userId:context.user.id,sessionId:context.session.id,action:row.action,payloadHash:row.payloadHash,expiresAtMs:Date.now()+60000});});return {id};
 }),
};
