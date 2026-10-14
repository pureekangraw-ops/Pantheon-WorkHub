export const dashboard = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pantheon WorkHub — Staging</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,sans-serif;background:#edf5fa;color:#142f4a}
*{box-sizing:border-box}body{margin:0}button,input,textarea{font:inherit}button{cursor:pointer;border:0;border-radius:11px;padding:10px 16px;background:#125eaa;color:#fff;font-weight:650}button:hover{background:#0b477f}button:disabled{opacity:.5;cursor:not-allowed}
header{background:#fff;border-bottom:1px solid #dce8f0;display:flex;justify-content:space-between;align-items:center;padding:18px clamp(20px,5vw,68px)}
header strong{font-size:20px;letter-spacing:-.4px}.tag{font-size:11px;font-weight:750;background:#e0f6f3;color:#087e74;border-radius:20px;padding:6px 10px;letter-spacing:.8px}
main{max-width:1130px;margin:38px auto;padding:0 20px}.headline{margin-bottom:26px}.headline h1{font-size:clamp(30px,4vw,42px);margin:0 0 8px;letter-spacing:-1.3px}.muted{color:#607a90;font-size:14px;line-height:1.6}
.layout{display:grid;grid-template-columns:1fr 1.15fr;gap:18px}.panel{background:#fff;border:1px solid #dae6ee;border-radius:19px;padding:23px;box-shadow:0 6px 25px #244a6510;margin-bottom:18px}.panel h2{font-size:18px;margin:0 0 15px}
label{display:block;font-size:13px;font-weight:700;margin:12px 0 7px}input,textarea{width:100%;padding:12px;border-radius:11px;border:1px solid #cbdce8;background:#fbfdff;color:#17334c;outline-color:#4a9ac8}textarea{min-height:135px;resize:vertical}
.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:15px}.secondary{background:#eaf2fa;color:#14548a}.secondary:hover{background:#d7e8f5}
#notice{font-size:13px;min-height:22px;color:#1b668a;margin:13px 0}.task{border:1px solid #dfeaf1;border-radius:12px;padding:13px;margin:9px 0}.taskhead{display:flex;justify-content:space-between;gap:8px;align-items:center}.taskid{font-family:ui-monospace,monospace;font-size:11px;overflow-wrap:anywhere;color:#54768c}
.state{font-size:11px;border-radius:20px;background:#ebf4fb;color:#14679d;padding:5px 9px;font-weight:750}.request{font-size:13px;margin:10px 0;color:#233c50;white-space:pre-wrap;overflow-wrap:anywhere}
pre{font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f8fb;padding:14px;border-radius:10px;max-height:260px;overflow:auto}
.stat{font-size:12px;font-weight:600;color:#55758d}#gate{display:block}#workspace{display:none}
footer{padding:20px;text-align:center;color:#718b9a;font-size:12px}@media(max-width:760px){.layout{grid-template-columns:1fr}main{margin-top:24px}header{padding:16px 20px}}
</style></head><body>
<header><strong>✦ Pantheon <span style="color:#217fbe">WorkHub</span></strong><span class="tag">STAGING ENVIRONMENT</span></header>
<main><div class="headline"><h1>Work, with proof.</h1><div class="muted">Queue instructions, explicitly run a safe artifact tool, and verify each result. This staging environment does not invoke external tools or AI automatically.</div></div>
<div id="gate" class="panel"><h2>Connect to your workspace</h2><p class="muted">Enter your staging access token. The token is kept in this page's memory only and is not saved in the browser.</p><label for="access">Access token</label><input id="access" type="password" autocomplete="off" placeholder="Staging access token"><div class="actions"><button id="connect">Connect</button></div></div>
<div id="workspace" class="layout">
 <section><div class="panel"><h2>Create a task</h2><div class="muted">HERMES can propose this task. Creating it does not run an action.</div><label for="request">Task instruction</label><textarea id="request" placeholder="Describe a text artifact to create..."></textarea><div class="actions"><button id="create">Queue task</button><button id="signout" class="secondary">Disconnect</button></div></div>
 <div class="panel"><h2>Verification detail</h2><pre id="details">Select a task to view its audit trail.</pre></div></section>
 <section><div class="panel"><div class="taskhead"><h2>Task queue</h2><span id="count" class="stat">0 tasks</span></div><button id="refresh" class="secondary">Refresh</button><div id="tasks"></div></div></section>
</div><div id="notice" role="status" aria-live="polite"></div>
</main><footer>Pantheon WorkHub • isolated Cloudflare staging • no production tools</footer>
<script>
(() => {
 const el=id=>document.getElementById(id); let token="";
 function notice(s){el("notice").textContent=s}
 async function api(path,body,method="POST"){
   const response=await fetch(path,{method,headers:{"authorization":"Bearer "+token,...(body===undefined?{}:{"content-type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)});
   const data=await response.json();if(!response.ok)throw new Error(data.error||"Request failed");return data;
 }
 async function load(){
  const result=await api("/v1/intent",{intent:"LIST_TASKS"});const tasks=el("tasks");tasks.replaceChildren();el("count").textContent=result.tasks.length+" tasks";
  if(!result.tasks.length){const p=document.createElement("p");p.className="muted";p.textContent="No tasks yet. Create one to begin.";tasks.append(p);}
  for(const item of result.tasks){
   const row=document.createElement("div");row.className="task";
   const head=document.createElement("div");head.className="taskhead";
   const identity=document.createElement("span");identity.className="taskid";identity.textContent=item.task_id;
   const state=document.createElement("span");state.className="state";state.textContent=item.status;head.append(identity,state);row.append(head);
   const description=document.createElement("p");description.className="request";description.textContent=item.request_text||"";row.append(description);
   const buttons=document.createElement("div");buttons.className="actions";
   const inspect=document.createElement("button");inspect.className="secondary";inspect.textContent="Inspect";inspect.onclick=()=>detail(item.task_id);
   buttons.append(inspect);
   if(item.status==="QUEUED"){const run=document.createElement("button");run.textContent="Run verified artifact";run.onclick=async()=>{if(!confirm("Run the staging text-artifact tool for this task?"))return;await taskAction(item.task_id,"run")};buttons.append(run);}
   if(item.status==="NEEDS_RECONCILIATION"||item.status==="RUNNING"){const recover=document.createElement("button");recover.className="secondary";recover.textContent="Recover";recover.onclick=()=>taskAction(item.task_id,"recover");buttons.append(recover);}
   if(item.status==="FAILED"){const retry=document.createElement("button");retry.className="secondary";retry.textContent="Queue retry";retry.onclick=()=>taskAction(item.task_id,"retry");buttons.append(retry);}
   row.append(buttons);tasks.append(row);
  }
 }
 async function detail(taskId){
   try{const [a,b,c]=await Promise.all([api("/v1/intent",{intent:"SHOW_TASK",task_id:taskId}),api("/v1/tasks/"+taskId+"/events",undefined,"GET"),api("/v1/tasks/"+taskId+"/artifact",undefined,"GET")]);el("details").textContent=JSON.stringify({task:a.task,artifact:c.artifact,events:b.events},null,2);}
   catch(err){notice(err.message)}
 }
 async function taskAction(taskId,action){try{const r=await api("/v1/tasks/"+taskId+"/"+action);notice(action+": "+r.status);await load();await detail(taskId)}catch(err){notice(err.message)}}
 el("connect").onclick=async()=>{token=el("access").value.trim();try{await load();el("access").value="";el("gate").style.display="none";el("workspace").style.display="grid";notice("Connected to staging workspace.")}catch(err){token="";notice(err.message)}};
 el("signout").onclick=()=>{token="";el("workspace").style.display="none";el("gate").style.display="block";el("details").textContent="Select a task to view its audit trail.";notice("Disconnected.")};
 el("refresh").onclick=()=>load().catch(e=>notice(e.message));
 el("create").onclick=async()=>{const request=el("request").value.trim();if(!request)return notice("Enter an instruction.");try{const r=await api("/v1/intent",{intent:"CREATE_TASK",request});el("request").value="";notice("Task queued: "+r.task_id);await load()}catch(err){notice(err.message)}};
})();
</script></body></html>`;
