(()=>{
  const TAG='__matthew_bridge';
  const GEN=(window.__matthewBridgeGen??0)+1; window.__matthewBridgeGen=GEN;
  const inflight=new Map();
  const reply=msg=>window.postMessage({[TAG]:'res',...msg},window.location.origin);

  function userSession(){
    let raw='';
    try{raw=localStorage.getItem('user')||'';}catch{}
    if(!raw)throw new Error('Matthew login data was not found in localStorage.user. Log in to Matthew first.');
    let user;
    try{user=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw new Error('Matthew localStorage.user is not valid JSON.');}
    const accessToken=user?.access_token||user?.accessToken;
    const sessionToken=user?.token||user?.session_token||user?.sessionToken;
    const assistantId=user?.defaultAssistant?.daid||user?.defaultAssistant?.id||user?.defaultAssistantId||'';
    if(!accessToken||!sessionToken)throw new Error('Matthew session is missing access_token or token. Please log in again.');
    return {accessToken,sessionToken,assistantId};
  }

  function serialize(messages=[]){
    return messages.map(m=>{
      const c=Array.isArray(m.content)
        ?m.content.map(p=>p?.type==='text'?p.text:'').filter(Boolean).join('\n')
        :String(m.content??'');
      if(!c)return '';
      if(m.role==='system')return `Instructions: ${c}`;
      if(m.role==='assistant')return `Assistant: ${c}`;
      if(m.role==='tool')return `Tool result (${m.name||m.tool_call_id||'tool'}): ${c}`;
      return `User: ${c}`;
    }).filter(Boolean).join('\n\n');
  }

  async function fetchWithTimeout(url,options={},ms=15000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),ms);
    try{return await fetch(url,{...options,signal:controller.signal});}
    catch(e){if(e?.name==='AbortError')throw new Error(`Matthew API timeout after ${ms/1000}s: ${url}`);throw e;}
    finally{clearTimeout(timer);}
  }

  async function postMessageToMatthew(prompt,session,model){
    const form=new FormData();
    form.append('token',session.sessionToken);
    form.append('message',prompt);
    form.append('thread_id','newchat');
    form.append('tid','newchat');
    if(session.assistantId)form.append('aid',session.assistantId);
    form.append('uname','Matthew Bridge');
    form.append('uname_th','Matthew Bridge');
    // Matthew currently resolves the model from the selected/default assistant.
    // Keep the requested model in the bridge protocol for OpenAI compatibility.
    if(model)form.append('model',model);
    const res=await fetchWithTimeout('/api/thread_sse_message',{
      method:'POST',credentials:'include',headers:{Authorization:`Bearer ${session.accessToken}`},body:form
    },15000);
    const text=await res.text();
    if(!res.ok)throw new Error(`Matthew message API returned ${res.status}: ${text.slice(0,400)}`);
    let data;try{data=JSON.parse(text);}catch{throw new Error(`Matthew returned non-JSON: ${text.slice(0,300)}`);}
    const thread=data?.new_thread?.thread_actual_id||data?.thread_actual_id||data?.thread_id||data?.new_thread?.thread_id;
    if(!thread)throw new Error(`Matthew returned no thread id: ${text.slice(0,300)}`);
    return thread;
  }

  async function streamUrl(thread,session){
    const res=await fetchWithTimeout('/api/thread_sse_ticket',{
      method:'POST',credentials:'include',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.accessToken}`},
      body:JSON.stringify({thread_id:thread})
    },15000);
    const text=await res.text();
    if(!res.ok)throw new Error(`Matthew stream ticket returned ${res.status}: ${text.slice(0,300)}`);
    let data;try{data=JSON.parse(text);}catch{throw new Error('Matthew stream ticket was not JSON.');}
    if(!data?.ticket)throw new Error('Matthew returned no stream ticket.');
    return `/api/thread_sse_response_stream?thread_id=${encodeURIComponent(thread)}&ticket=${encodeURIComponent(data.ticket)}`;
  }

  async function run(job){
    const controller=new AbortController(); inflight.set(job.jobId,controller);
    const debug=message=>reply({jobId:job.jobId,kind:'debug',message});
    try{
      debug('run-start');
      const session=userSession();
      debug(`session-ok assistant=${session.assistantId?'yes':'no'}`);
      const prompt=typeof job.prompt==="string" ? job.prompt : serialize(job.messages);
      if(!prompt.trim())throw new Error('No usable message content.');
      debug(`message-start model=${job.model||'default'}`);
      const thread=await postMessageToMatthew(prompt,session,job.model);
      debug(`message-ok thread=${thread}`);
      const url=await streamUrl(thread,session);
      debug('ticket-ok stream-start');
      const res=await fetch(url,{credentials:'include',signal:controller.signal,headers:{Accept:'text/event-stream'}});
      if(!res.ok||!res.body)throw new Error(`Matthew SSE returned ${res.status}`);
      const reader=res.body.getReader(); const decoder=new TextDecoder(); let pending='';
      let eventName=''; let finished=false;
      for(;;){
        const {value,done}=await reader.read(); if(done)break;
        pending+=decoder.decode(value,{stream:true});
        let cut;
        while((cut=pending.search(/\r?\n\r?\n/))!==-1){
          const frame=pending.slice(0,cut); pending=pending.slice(cut+pending.slice(cut).match(/^\r?\n\r?\n/)[0].length);
          let dataLines=[];
          for(const line of frame.split(/\r?\n/)){
            if(line.startsWith('event:'))eventName=line.slice(6).trim();
            else if(line.startsWith('data:'))dataLines.push(line.slice(5).trim());
          }
          if(!dataLines.length){eventName='';continue;}
          const raw=dataLines.join('\n');
          if(raw==='[DONE]'){finished=true;eventName='';continue;}
          let data=null;try{data=JSON.parse(raw);}catch{data={message:raw};}
          if(eventName==='error'||data?.error){throw new Error(String(data?.error||data?.message||'Matthew stream error'));}
          if(eventName==='complete'||eventName==='done'){finished=true;eventName='';continue;}
          const text=typeof data?.message==='string'?data.message
            :typeof data?.content==='string'?data.content
            :typeof data?.delta==='string'?data.delta:'';
          if(text)reply({jobId:job.jobId,kind:'chunk',parts:[{kind:'text',text}]});
          eventName='';
        }
      }
      reply({jobId:job.jobId,kind:'done',finishReason:finished?'stop':'stop'});
    }catch(e){
      if(e?.name==='AbortError')reply({jobId:job.jobId,kind:'done',finishReason:'stop'});
      else reply({jobId:job.jobId,kind:'error',message:String(e?.message??e)});
    }finally{inflight.delete(job.jobId);}
  }

  window.addEventListener('message',event=>{
    if(window.__matthewBridgeGen!==GEN||event.source!==window)return;
    const msg=event.data;if(!msg||typeof msg!=='object')return;
    if(msg[TAG]==='req'&&msg.job)void run(msg.job);
    else if(msg[TAG]==='abort')inflight.get(msg.jobId)?.abort();
  });
  reply({kind:'page-ready'});
})();
