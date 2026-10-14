import {WorkerEntrypoint} from 'cloudflare:workers';
import workhub from './worker.js';
import {ownerBridgeCall} from './owner-bridge.mjs';
import {handleMcp} from './mcp-router.mjs';
export default {
 async fetch(request,env,ctx){return await handleMcp(request,env,ctx)??workhub.fetch(request,env,ctx);},
 scheduled(event,env,ctx){return workhub.scheduled(event,env,ctx);}
};
export class OwnerBridge extends WorkerEntrypoint {
 async fetch(){return new Response('Not found',{status:404});}
 async ownerCall(args){return ownerBridgeCall(this.env,workhub,args);}
}
