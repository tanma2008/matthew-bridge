const DEFAULT_BRIDGE='http://127.0.0.1:8788';
let keepalivePorts=0;
let lastError='';

async function bridgeUrl(){
  try{
    const x=await chrome.storage.local.get('bridgeUrl');
    return (!x.bridgeUrl||x.bridgeUrl==='http://127.0.0.1:8787')?DEFAULT_BRIDGE:x.bridgeUrl;
  }catch{return DEFAULT_BRIDGE;}
}

async function findMatthewTab(){
  const active=await chrome.tabs.query({active:true,currentWindow:true});
  const hit=active.find(t=>t.url?.startsWith('https://matthew.cmu.ac.th/')&&!t.discarded);
  if(hit)return hit;
  const tabs=await chrome.tabs.query({url:['https://matthew.cmu.ac.th/*']});
  return tabs.find(t=>!t.discarded&&t.url?.startsWith('https://matthew.cmu.ac.th/'))??null;
}

chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=='keepalive')return;
  keepalivePorts++;
  port.onDisconnect.addListener(()=>{keepalivePorts=Math.max(0,keepalivePorts-1);});
});

chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
  if(msg?.type==='status'){
    (async()=>{
      const tab=await findMatthewTab();
      sendResponse({connected:keepalivePorts>0,lastError,bridgeUrl:await bridgeUrl(),tab:tab?{id:tab.id,url:tab.url}:null,activeJobs:0});
    })();
    return true;
  }
  if(msg?.type==='reconnect'){
    lastError='';
    sendResponse({ok:true});
    return true;
  }
});
