// The only capability of this isolated deployment is sandbox commerce read.
export async function shopOrdersRead(env,input={}) {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='cursor')||
    (input.cursor!==undefined&&(typeof input.cursor!=='string'||input.cursor.length>160)))return {ok:false,code:'INVALID_READ_REQUEST'};
 if(typeof env.SHOP_COMMERCE_READ?.shopOrdersRead!=='function')return {ok:false,code:'SHOP_BRIDGE_NOT_CONFIGURED'};
 try {
  const result=await env.SHOP_COMMERCE_READ.shopOrdersRead(input);
  if(!result||result.ok!==true)return {ok:false,code:'SHOP_READ_UNAVAILABLE'};
  if(result.mode!=='test'||!Array.isArray(result.orders)||result.orders.length>100||
    !(result.next_cursor===null||(typeof result.next_cursor==='string'&&result.next_cursor.length<=160&&/^\d{1,16}:cs_test_[A-Za-z0-9_]+$/.test(result.next_cursor))))return {ok:false,code:'INVALID_SHOP_RESPONSE'};
  const orders=[];
  for(const row of result.orders){
   if(!row||!/^cs_test_[A-Za-z0-9_]+$/.test(row.order_id)||!Number.isSafeInteger(row.amount_minor)||row.amount_minor<=0||
      !['thb','usd'].includes(row.currency)||!['pending','paid'].includes(row.payment_status)||
      row.download_authorized!==(row.payment_status==='paid')||row.download_evidence!=='not_recorded'||row.customer_receipt!=='unknown')return {ok:false,code:'INVALID_SHOP_RESPONSE'};
   const {order_id,amount_minor,currency,payment_status,download_authorized,download_evidence,customer_receipt}=row;
   orders.push({order_id,amount_minor,currency,payment_status,download_authorized,download_evidence,customer_receipt});
  }
  return {ok:true,mode:'test',next_cursor:result.next_cursor,orders};
 }catch{return {ok:false,code:'SHOP_READ_UNAVAILABLE'}}
}
