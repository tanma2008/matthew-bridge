async function refresh(){
  try{
    const s=await chrome.runtime.sendMessage({type:'status'});
    const el=document.getElementById('status');
    el.textContent=s.connected?'🟢 Connected':'🔴 Bridge disconnected';
    el.className=s.connected?'ok':'bad';
    document.getElementById('tab').textContent=s.tab?.url||'No Matthew tab';
    document.getElementById('jobs').textContent=s.activeJobs??0;
  }catch(e){document.getElementById('status').textContent=`Error: ${e?.message??e}`;}
}
document.getElementById('reconnect').onclick=async()=>{await chrome.runtime.sendMessage({type:'reconnect'});setTimeout(refresh,500);};
refresh();
