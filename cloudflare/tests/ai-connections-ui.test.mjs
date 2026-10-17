import test from 'node:test';
import assert from 'node:assert/strict';
import workhub from '../production/worker.js';

async function dashboard(){
 const response=await workhub.fetch(new Request('https://pantheon.example/'),{});
 assert.equal(response.status,200);
 return {html:await response.text(),csp:response.headers.get('content-security-policy')};
}

test('AI Connections profiles and disabled Review Queue disclose verification gaps',async()=>{
 const {html}=await dashboard();
 for(const text of ['Review Queue','AI Connections','AI Runtime','GO Brain','LIGHT BOOK','HERMES','UNKNOWN · NOT VERIFIED','No verified PANTHEON server-side GitHub or GitLab PR/MR connector','not fabricated','task-level permissions','brain-owner','brain_search','LIGHT_BOOKMARK_TOKEN','health-only','WORKHUB_TOKEN','cloud-owner','Per-human login, roles, and per-task grants are not implemented here']) assert.ok(html.includes(text),`missing UI assertion text: ${text}`);
 assert.match(html,/<section id="view-review" class="view-panel">[\s\S]*?Unavailable — read-only connector not verified/);
 assert.match(html,/<h3>LIGHT<\/h3>[\s\S]*?LIGHT BOOK/);
});

test('runtime UI allows only loopback /v1 endpoint forms',async()=>{
 const {html}=await dashboard();
 const match=html.match(/function normalizeLocalBase\(raw\)\s*\{[\s\S]*?\n \}/);
 assert.ok(match,'loopback validation helper must be present');
 const normalize=new Function(`${match[0]}\nreturn normalizeLocalBase;`)();
 assert.equal(normalize('http://localhost:8080/v1'),'http://localhost:8080/v1');
 assert.equal(normalize('http://127.0.0.1:1234'),'http://127.0.0.1:1234/v1');
 for(const endpoint of ['https://localhost/v1','http://example.com/v1','http://localhost.evil/v1','http://user:pass@localhost/v1','http://localhost/v2','http://localhost/v1?token=x','http://[::1]/v1','']) assert.throws(()=>normalize(endpoint),endpoint);
});

test('runtime tests are direct, ephemeral, unauthenticated local requests',async()=>{
 const {html,csp}=await dashboard();
 assert.match(csp,/connect-src 'self' http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/);
 new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
 assert.ok(html.includes('function directLocalFetch(url,options){return fetch(url,{...options,mode:"cors",credentials:"omit",cache:"no-store",referrerPolicy:"no-referrer"});}'));
 assert.ok(html.includes('base+"/models"'));
 assert.ok(html.includes('base+"/chat/completions"'));
 assert.ok(html.includes('messages:[{role:"user",content:prompt}]'));
 assert.ok(html.includes('const runtimeHistory=[]'));
 assert.ok(!html.includes('localStorage')&&!html.includes('sessionStorage'));
});

test('Dashboard does not proxy AI diagnostics or add an unauthenticated review API',async()=>{
 const {html}=await dashboard();
 assert.match(html,/No endpoint, prompt, or response is proxied through PANTHEON or Cloudflare/);
 const anonymous=await workhub.fetch(new Request('https://pantheon.example/v1/intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intent:'LIST_TASKS'})}),{WORKHUB_TOKEN:'test-only-token-which-is-at-least-thirty-two-characters'});
 assert.equal(anonymous.status,401);
});
