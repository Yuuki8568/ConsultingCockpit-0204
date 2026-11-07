"""Write a self-contained offline review page; never execute transcript strings."""
import json
from pathlib import Path

def write_review(folder: Path, source_name: str, rows: list):
    payload = json.dumps({'sourceName': source_name, 'segments': rows},ensure_ascii=False).replace('&','\\u0026').replace('<','\\u003c').replace('>','\\u003e').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
    page = '''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src blob:; connect-src 'none'"><title>文字起こしの確認</title><style>body{font:16px system-ui;max-width:1000px;margin:30px auto;padding:16px;background:#f6f8fa;color:#18232c}section{background:white;border:1px solid #ccd6df;padding:18px;margin:14px 0;border-radius:12px}textarea{box-sizing:border-box;width:100%;min-height:90px;font:inherit;padding:10px}button{padding:10px 18px;margin:6px;border-radius:6px;cursor:pointer}pre{white-space:pre-wrap}video{width:100%;max-height:240px}.warn{color:#8b4100}header{position:sticky;top:0;background:#f6f8fa;padding:10px;z-index:1}</style><h1>原音と文章を確認</h1><p>原文は変更せず、修正後の文章を別に保存します。数字・日付・金額・否定は特に確認してください。推測だけで決定事項を確定しないでください。</p><p>確認中の編集はこの画面を閉じると消えます。録音は外部へ送信しません。</p><label>原音を選択して再生 <input id="media" type="file" accept="audio/*,video/*"></label><video id="player" controls></video><header><span id="count"></span><button id="export" disabled>確認済みJSONを書き出す</button><button id="txt" disabled>確認済み文章を書き出す</button></header><main id="rows"></main><script>
const data=__PAYLOAD__;
const player=document.querySelector('#player'), container=document.querySelector('#rows'), states=[];
let mediaUrl;
document.querySelector('#media').onchange=e=>{if(mediaUrl)URL.revokeObjectURL(mediaUrl);if(e.target.files[0]){mediaUrl=URL.createObjectURL(e.target.files[0]);player.src=mediaUrl;}};
function update(){const n=states.filter(x=>x.checked.checked).length;document.querySelector('#count').textContent=`${n} / ${states.length} 区間を確認`;document.querySelector('#export').disabled=document.querySelector('#txt').disabled=!states.length||n!==states.length;}
for(const row of data.segments){
 const section=document.createElement('section');
 const title=document.createElement('h2');title.textContent=`${row.start.toFixed(1)}〜${row.end.toFixed(1)}秒`;section.append(title);
 const original=document.createElement('pre');original.textContent=row.text;section.append(original);
 if(/[0-9０-９]|ない|ません|未定|万円|期限|合意/.test(row.text)){const p=document.createElement('p');p.className='warn';p.textContent='数字・否定・条件を含みます。原音を確認してください。';section.append(p);}
 const play=document.createElement('button');play.textContent='この区間を再生';play.onclick=()=>{if(!player.src){alert('先に原音ファイルを選択してください。');return;}player.currentTime=Math.max(0,row.start-1);player.play().catch(()=>{});};section.append(play);
 const edit=document.createElement('textarea');edit.value=row.text;edit.setAttribute('aria-label',`${row.start}秒の修正後の文章`);section.append(edit);
 if(row.suggestion && row.suggestion!==row.text){const candidate=document.createElement('pre');candidate.textContent='補正候補（未確認）: '+row.suggestion;section.append(candidate);const reason=document.createElement('p');reason.textContent=row.reason||'';section.append(reason);const apply=document.createElement('button');apply.textContent='候補を編集欄へ入れる';apply.onclick=()=>{edit.value=row.suggestion;checked.checked=false;update();};section.append(apply);}
 const label=document.createElement('label'),checked=document.createElement('input');checked.type='checkbox';label.append(checked,document.createTextNode(' 原音・内容を確認しました'));section.append(label);
 checked.onchange=update;edit.oninput=()=>{checked.checked=false;update();};states.push({row,edit,checked});container.append(section);
}
function download(name,body,type){const url=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.querySelector('#export').onclick=()=>{if(states.some(x=>!x.checked.checked))return;download('cockpit-reviewed.json',JSON.stringify({format:'cockpit-transcript-review',version:2,recognition:{mode:'accurate',model:'Systran/faster-whisper-medium',revision:'08e178d48790749d25932bbc082711ddcfdfbc4f'},sourceName:data.sourceName,reviewedAt:new Date().toISOString(),segments:states.map(({row,edit})=>({start:row.start,end:row.end,original:row.text,text:edit.value,reviewed:true}))},null,2),'application/json');};
document.querySelector('#txt').onclick=()=>{if(states.some(x=>!x.checked.checked))return;download('transcript-reviewed.txt',states.map(x=>x.edit.value).join('\\n'),'text/plain');};update();
</script></html>'''
    (folder/'review.html').write_text(page.replace('__PAYLOAD__',payload),encoding='utf-8')
