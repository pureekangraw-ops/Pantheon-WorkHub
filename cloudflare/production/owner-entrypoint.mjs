import {WorkerEntrypoint} from 'cloudflare:workers';
import workhub from './worker.js';
import {ownerBridgeCall} from './owner-bridge.mjs';
export default workhub;
export class OwnerBridge extends WorkerEntrypoint {
 async fetch(){return new Response('Not found',{status:404});}
 async ownerCall(args){return ownerBridgeCall(this.env,workhub,args);}
}
