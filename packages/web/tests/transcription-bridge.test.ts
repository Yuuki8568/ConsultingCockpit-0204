import { test, expect } from 'bun:test';
import { applyLocalTranscript, validateLocalTranscript, type LocalTranscript } from '../src/web/lib/transcription/bridge';
import { makeEmptyCase } from '../src/web/domain/logic/state';
const result: LocalTranscript={model:'Systran/faster-whisper-medium',revision:'08e178d48790749d25932bbc082711ddcfdfbc4f',sourceName:'meeting.wav',sourceKind:'audio',durationSeconds:12,segments:[{start:0,end:12,text:'確認が必要な発言'}]};
test('precise result stays unreviewed, retains originals and does not overwrite business fields',()=>{
 const c=makeEmptyCase('test');const before=JSON.stringify(c.memo);
 c.recordings=[{id:'rec',transcript:''} as any];applyLocalTranscript(c,'rec',result);
 expect(c.recordings[0].transcript).toBe(result.segments[0].text);
 expect(c.recordings[0].transcriptReview).toBeUndefined();expect(c.recordings[0].localRecognition?.segments).toEqual(result.segments);
 expect(JSON.stringify(c.memo)).toBe(before);expect(()=>applyLocalTranscript(c,'rec',result)).toThrow();
});
test('malformed or wrong model results never enter case storage',()=>{
 for(const patch of [{model:'small'},{revision:'other'},{durationSeconds:10801},{segments:[{start:0,end:13,text:'bad'}]},{segments:[{start:1,end:2,text:'a'},{start:0,end:1,text:'b'}]}])expect(()=>validateLocalTranscript({...result,...patch})).toThrow();
});
