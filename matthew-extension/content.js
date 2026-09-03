(() => {
  const GEN=(window.__matthewBridgeContentGen??0)+1; window.__matthewBridgeContentGen=GEN;
  const current=()=>window.__matthewBridgeContentGen===GEN;
  const TAG='__matthew_bridge';
  async function toWorker(payload,attempt=0){
    try{await chrome.runtime.sendMessage({type:'from-page',payload});}
    catch{if(attempt<5)setTimeout(()=>toWorker(payload,attempt+1),200*(attempt+1));}
  }
  window.addEventListener('message',event=>{
    if(!current()||event.source!==window)return;
    const msg=event.data;
    if(!msg||typeof msg!=='object'||msg[TAG]!=='res')return;
    const {[TAG]:_,...payload}=msg; void toWorker(payload);
  });
  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if(!current())return;
    if(msg?.type==='run')window.postMessage({[TAG]:'req',job:msg.job},window.location.origin);
    else if(msg?.type==='abort')window.postMessage({[TAG]:'abort',jobId:msg.jobId},window.location.origin);
    else if(msg?.type==='ping'){sendResponse({ok:true});return true;}
  });
  function keepAlive(){
    let port; try{port=chrome.runtime.connect({name:'keepalive'});}catch{setTimeout(keepAlive,1000);return;}
    const beat=setInterval(()=>{try{port.postMessage({t:Date.now()});}catch{}},20000);
    const cycle=setTimeout(()=>port.disconnect(),4*60*1000);
    port.onDisconnect.addListener(()=>{clearInterval(beat);clearTimeout(cycle);setTimeout(keepAlive,250);});
  }
  keepAlive();
})();
