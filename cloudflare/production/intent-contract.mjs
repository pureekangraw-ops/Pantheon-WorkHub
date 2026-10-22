// The existing /v1/intent contracts, shared by explicit and proposed routes.
// This is a request contract table, not a runner registry or authority grant.
export const INTENT_CONTRACTS = Object.freeze({
  CREATE_TASK: Object.freeze({fields:Object.freeze(['intent','request']), effect:'prepare', tool:'d1.create_text_artifact'}),
  SHOW_TASK: Object.freeze({fields:Object.freeze(['intent','task_id']), effect:'read', tool:'tasks.read'}),
  LIST_TASKS: Object.freeze({fields:Object.freeze(['intent']), effect:'read', tool:'tasks.list'}),
});
export const taskId = v => typeof v === 'string' && /^task_[a-f0-9]{32}$/.test(v);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
export function validateIntent(value, fail) {
  if (!object(value) || typeof value.intent !== 'string') throw fail('invalid intent');
  const contract = Object.hasOwn(INTENT_CONTRACTS, value.intent) && INTENT_CONTRACTS[value.intent];
  if (!contract) throw fail('unsupported intent');
  if (Object.keys(value).sort().join('|') !== [...contract.fields].sort().join('|')) throw fail('invalid fields');
  if (value.intent === 'CREATE_TASK' && (typeof value.request !== 'string' || !value.request.trim() || value.request.length > 4096)) throw fail('invalid request');
  if (value.intent === 'SHOW_TASK' && !taskId(value.task_id)) throw fail('invalid task ID');
  return value;
}
export function validateOutcome(value, fail) {
  if (!object(value) || Object.keys(value).some(k => !['request','task_id'].includes(k))) throw fail('invalid outcome fields');
  if (typeof value.request !== 'string' || !value.request.trim() || value.request.length > 4000) throw fail('invalid request');
  if (Object.hasOwn(value,'task_id') && !taskId(value.task_id)) throw fail('invalid task ID');
  return value;
}

// Exact, deliberately small grammar. Model/tool/page output is never authority.
// In particular no substring match, URL, action ID, approval or scope is executed.
export function proposeOutcome(input) {
  const text = input.request.trim().toLowerCase();
  if (text === 'what can you do?' || text === 'what can you do' || text === 'ทำอะไรได้บ้าง') return {status:'DISCOVERY',reason:'DECLARED_CONTRACTS_ONLY'};
  if (/^(list|show) (my )?tasks[.!]?$/.test(text) || text === 'แสดงรายการงาน')
    return input.task_id ? {status:'AMBIGUOUS',reason:'LIST_WITH_TASK_ID',question:'List all tasks or show the specified task?'} : {action:{intent:'LIST_TASKS'}};
  if (/^(show|check) (this |my )?task(?: status)?[.!]?$/.test(text) || text === 'ดูสถานะงาน')
    return input.task_id ? {action:{intent:'SHOW_TASK',task_id:input.task_id}} : {status:'AMBIGUOUS',reason:'TASK_ID_REQUIRED',question:'Which existing task should I read?'};
  if (/^save this request as a text artifact[.!]?$/.test(text))
    return {action:{intent:'CREATE_TASK',request:input.request}};
  if (/^(build|create|make) (me )?(a )?click[- ]counter (webpage|website)[.!]?$/.test(text) || text === 'สร้างเว็บนับคลิก')
    return {status:'UNSUPPORTED',domain:'CODE',reason:'WEBSITE_TO_EDGE_JOB_ADAPTER_MISSING',missing:['A declared adapter from the requested website to FACTORY_EDGE_JOB_V1 source, patch and HTTP assertions','Existing PANTHEON rail does not grant EXECUTE:CODE or DEPLOY:CODE'],source:'Factory-District/src/edge-providers.mjs; src/rail-auth.mjs'};
  if (/^(create|make|render) (a )?(visual|image|static card)[.!]?$/.test(text))
    return {status:'UNSUPPORTED',domain:'VISUAL',reason:'PANTHEON_VISUAL_ADAPTER_AND_AUTHORITY_MISSING',missing:['Validated static-card design input adapter','Existing PANTHEON rail does not grant EXECUTE:VISUAL'],source:'Factory-District/src/edge-providers.mjs; src/rail-auth.mjs'};
  if (/^(place|train) (a )?logic trainee[.!]?$/.test(text))
    return {status:'UNSUPPORTED',domain:'LOGIC',reason:'NATURAL_LANGUAGE_FACTORY_PREPARATION_NOT_ENABLED',missing:['Use the existing explicitly scoped LOGIC training workflow; this outcome route does not queue or dispatch Factory'],source:'worker.js: queueFactoryJob, queueExistingFactoryJob, dispatchFactoryJob'};
  return {status:'UNKNOWN',reason:'NO_EXPLICIT_SUPPORTED_INTENT'};
}

// These are adapter obligations, used by the route, not a second execution path.
export function validateProposal(proposal, parse) {
  const fail = () => { throw new Error('INVALID_INTENT_PROPOSAL'); };
  if (!object(proposal)) fail();
  if (Object.hasOwn(proposal,'action')) {
    if (Object.keys(proposal).length !== 1) fail();
    const action = parse(proposal.action);
    return {action:{...action},contract:INTENT_CONTRACTS[action.intent]};
  }
  if (!['UNKNOWN','UNSUPPORTED','AMBIGUOUS','DISCOVERY'].includes(proposal.status) ||
      typeof proposal.reason !== 'string' || !proposal.reason ||
      Object.keys(proposal).some(k => !['status','reason','question','domain','missing','source'].includes(k))) fail();
  if (proposal.question !== undefined && typeof proposal.question !== 'string') fail();
  if (proposal.domain !== undefined && !['CODE','VISUAL','LOGIC'].includes(proposal.domain)) fail();
  if (proposal.source !== undefined && typeof proposal.source !== 'string') fail();
  if (proposal.missing !== undefined && (!Array.isArray(proposal.missing) || proposal.missing.some(x => typeof x !== 'string'))) fail();
  return {...proposal};
}
