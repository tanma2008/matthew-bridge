const DEFAULT_BRIDGE = 'http://127.0.0.1:8787';
const RECONNECT_MS = 3000;
let controller = null;
let connected = false;
let lastError = '';
const jobTabs = new Map();

async function bridgeUrl() {
  try { const x = await chrome.storage.local.get('bridgeUrl'); return x.bridgeUrl || DEFAULT_BRIDGE; }
  catch { return DEFAULT_BRIDGE; }
}
async function post(path, body) {
  try { await fetch(`${await bridgeUrl()}${path}`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(body) }); }
  catch (e) { lastError = String(e?.message ?? e); console.warn('[matthew-bg]', path, lastError); }
}
async function findMatthewTab() {
  const tabs = await chrome.tabs.query({ url: ['https://matthew.cmu.ac.th/*'] });
  const live = tabs.filter(t => !t.discarded && t.status !== 'unloaded');
  return (live.length ? live : tabs).find(t => t.url?.startsWith('https://matthew.cmu.ac.th/')) ?? null;
}
async function ensureContentScript(tab) {
  try { await chrome.tabs.sendMessage(tab.id, {type:'ping'}); return; } catch {}
  await chrome.scripting.executeScript({target:{tabId:tab.id}, world:'MAIN', files:['page.js']}).catch(()=>{});
  await chrome.scripting.executeScript({target:{tabId:tab.id}, world:'ISOLATED', files:['content.js']}).catch(()=>{});
  await chrome.tabs.sendMessage(tab.id, {type:'ping'});
}
async function handleJob(job) {
  const tab = await findMatthewTab();
  if (!tab) return post('/ext/error', {jobId:job.jobId, message:'No matthew.cmu.ac.th tab is open. Open Matthew and log in.'});
  jobTabs.set(job.jobId, tab.id);
  try { await ensureContentScript(tab); await chrome.tabs.sendMessage(tab.id, {type:'run', job}); }
  catch (e) { jobTabs.delete(job.jobId); await post('/ext/error', {jobId:job.jobId, message:`Cannot reach Matthew tab: ${e?.message ?? e}`}); }
}
function handleEvent(name, data) {
  if (name === 'job') void handleJob(data);
  else if (name === 'abort') { const tabId=jobTabs.get(data.jobId); if(tabId!=null) chrome.tabs.sendMessage(tabId,{type:'abort',jobId:data.jobId}).catch(()=>{}); jobTabs.delete(data.jobId); }
}
async function connect() {
  if (controller) return;
  controller = new AbortController();
  try {
    const res = await fetch(`${await bridgeUrl()}/matthew/events`, {headers:{accept:'text/event-stream'}, signal:controller.signal});
    if (!res.ok || !res.body) throw new Error(`bridge ${res.status}`);
    connected = true; lastError='';
    const reader=res.body.getReader(); const decoder=new TextDecoder(); let pending='';
    for (;;) {
      const {value,done}=await reader.read(); if(done) break;
      pending += decoder.decode(value,{stream:true});
      let cut;
      while((cut=pending.search(/\r?\n\r?\n/))!==-1) {
        const frame=pending.slice(0,cut); pending=pending.slice(cut+pending.slice(cut).match(/^\r?\n\r?\n/)[0].length);
        let name='message'; const lines=[];
        for(const line of frame.split(/\r?\n/)){ if(line.startsWith('event:')) name=line.slice(6).trim(); else if(line.startsWith('data:')) lines.push(line.slice(5).trim()); }
        if(!lines.length) continue;
        try{handleEvent(name,JSON.parse(lines.join('\n')))}catch{}
      }
    }
  } catch(e) { if(e?.name!=='AbortError') lastError=String(e?.message??e); }
  finally { connected=false; controller=null; setTimeout(connect,RECONNECT_MS); }
}
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'keepalive') return;
  connect();
  port.onMessage.addListener(()=>{});
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'from-page') {
    const p=msg.payload;
    if(p.kind==='chunk') post('/ext/chunk',{jobId:p.jobId,parts:p.parts});
    else if(p.kind==='done'){jobTabs.delete(p.jobId);post('/ext/done',{jobId:p.jobId,finishReason:p.finishReason});}
    else if(p.kind==='error'){jobTabs.delete(p.jobId);post('/ext/error',{jobId:p.jobId,message:p.message});}
    return;
  }
  if(msg?.type==='status'){
    (async()=>{const tab=await findMatthewTab();sendResponse({connected,lastError,bridgeUrl:await bridgeUrl(),tab:tab?{id:tab.id,url:tab.url}:null,activeJobs:jobTabs.size});})();
    return true;
  }
  if(msg?.type==='reconnect'){controller?.abort();connect();sendResponse({ok:true});return true;}
});
chrome.alarms.create('keepalive',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(()=>connect());
connect();
