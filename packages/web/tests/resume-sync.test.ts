import {test,expect} from "bun:test";
import {installResumeSync} from "../src/web/lib/resume-sync";
test("resume sync stays locked/offline, coalesces events and resumes after suspension", async()=>{
 const window=new EventTarget(),document=new EventTarget();let visible=true,ready=false,now=0,calls=0;
 const stop=installResumeSync({window,document,visible:()=>visible,ready:()=>ready,now:()=>now,sync:async()=>{calls++}});
 window.dispatchEvent(new Event("focus"));expect(calls).toBe(0);
 ready=true;visible=false;document.dispatchEvent(new Event("visibilitychange"));expect(calls).toBe(0);
 visible=true;document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new Event("focus"));expect(calls).toBe(1);
 now=3000;window.dispatchEvent(new Event("pageshow"));expect(calls).toBe(2);
 ready=false;now=6000;window.dispatchEvent(new Event("focus"));expect(calls).toBe(2);
 stop();ready=true;now=9000;window.dispatchEvent(new Event("focus"));expect(calls).toBe(2);
});
