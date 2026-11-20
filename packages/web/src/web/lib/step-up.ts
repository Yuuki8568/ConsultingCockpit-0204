import { startAuthentication } from "@simplewebauthn/browser";
import { client } from "./api";
import { operationHash } from "../../shared/operation-proof";
export async function authorize(
  action: Parameters<typeof client.passkeys.authenticationOptions>[0]["action"],
  payload: unknown,
) {
  const challenge = await client.passkeys.authenticationOptions({
    action,
    payloadHash: await operationHash(payload),
  });
  const response = await startAuthentication({ optionsJSON: challenge.options });
  return (await client.passkeys.authenticate({ id: challenge.id, response })).id;
}
