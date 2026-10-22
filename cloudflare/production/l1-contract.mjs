export const L1_TASK_ID='task_d6c9e93a42fd4f339bb47d941428dd08';
export const L1_REQUEST_SHA256='de0038fe8be999fe6a1c725156cd9684ac4887127ef783a659148ccdf36d0b24';
export const L1_INTENT='CREATE_L1_TEXT_ARTIFACT';
export const L1_SCOPE='EXECUTE:TEXT_ARTIFACT:L1';
export const L1_RECEIPT_ID='receipt-l1-'+L1_TASK_ID.slice(5);
export const L1_ARTIFACT_REF=`factory-artifact://factory/l1/${L1_TASK_ID}/${L1_REQUEST_SHA256}`;
export async function verifyL1Readback(back){
 const a=back?.result;
 if(back?.receiptId!==L1_RECEIPT_ID || back.workId!==L1_TASK_ID || back.checkpointId!=='cp-'+L1_TASK_ID || back.workPassRef!=='work-pass://pantheon-'+L1_TASK_ID || back.actingActor!=='PANTHEON' || back.evidenceRef!==L1_ARTIFACT_REF || !/^[a-f0-9]{40}$/.test(back.sourceSha||''))return false;
 if(!a || a.taskId!==L1_TASK_ID || a.requestSha256!==L1_REQUEST_SHA256 || a.checkpointId!=='cp-'+L1_TASK_ID || a.artifactRef!==L1_ARTIFACT_REF || a.contentType!=='text/plain; charset=utf-8' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(a.testTimestamp||'') || !Number.isFinite(Date.parse(a.testTimestamp)) || new Date(a.testTimestamp).toISOString()!==a.testTimestamp)return false;
 const expected=`YGG FACTORY L1 PASS\ntask_id=${L1_TASK_ID}\ncheckpoint_id=cp-${L1_TASK_ID}\nrequest_sha256=${L1_REQUEST_SHA256}\ntest_timestamp=${a.testTimestamp}\n`;
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(expected)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 return a.content===expected && a.contentSha256===hash && JSON.stringify(a.evidenceRefs)===JSON.stringify([L1_ARTIFACT_REF]) && back.status==='HANDOFF_VERIFIED' && back.boundaryVerified===true && back.domainCompleted===true && back.domainVerified===true;
}
