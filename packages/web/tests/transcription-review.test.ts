import { test, expect } from 'bun:test';
import { parseTranscriptReview, MAX_REVIEW_BYTES } from '../src/web/lib/transcription/review';
const good = () => ({format:'cockpit-transcript-review',version:2,recognition:{mode:'accurate',model:'Systran/faster-whisper-medium',revision:'08e178d48790749d25932bbc082711ddcfdfbc4f'},sourceName:'面談.mp4',reviewedAt:'2026-10-23T00:00:00Z',segments:[{start:1,end:2,original:'予算は未定',text:'予算は未定',reviewed:true}]});
test('review handoff preserves original, edits and timestamps', () => {
 const x=good(); x.segments[0].text='予算は未定です';
 const r=parseTranscriptReview(JSON.stringify(x));
 expect(r.originalText).toBe('予算は未定'); expect(r.importedText).toBe('予算は未定です'); expect(r.segments[0].start).toBe(1);
});
test('rejects unreviewed, malformed and incompatible bundles', () => {
 for (const change of [ {version:1}, {recognition:{mode:"standard",model:"small"}}, {segments:[]}, {reviewedAt:'bad'}, {segments:[{...good().segments[0],reviewed:false}]}, {segments:[{...good().segments[0],start:-1}]}, {segments:[{...good().segments[0],end:10801}]}, {segments:[{...good().segments[0],text:{html:'bad'}}]} ]) expect(()=>parseTranscriptReview(JSON.stringify({...good(),...change}))).toThrow();
 expect(()=>parseTranscriptReview('x'.repeat(MAX_REVIEW_BYTES+1))).toThrow();
 expect(()=>parseTranscriptReview('{')).toThrow();
});
test('keeps literal text instead of executing or stripping it', () => {
 const x=good();x.segments[0].text='<script>alert(1)</script>';
 expect(parseTranscriptReview(JSON.stringify(x)).importedText).toBe(x.segments[0].text);
});
