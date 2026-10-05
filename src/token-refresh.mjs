// v5 Lite fields follow KuGouMusicApi/module/login_token.js (MakcRe, MIT).
// Archived implementation for reference/tests only. Production auth uses native KuGouMusicApi modules; no legacy v4 fallback.
export async function refreshLite(params,request,crypto) {
  const {cryptoAesEncrypt:encrypt,cryptoAesDecrypt:decrypt,cryptoRSAEncrypt:rsa}=crypto;
  const cookie=params.cookie,now=Date.now();
  const envelope=encrypt({});
  const data={
    dfid:cookie.dfid||'-',userid:cookie.userid,plat:1,clienttime_ms:now,
    p3:encrypt({clienttime:Math.floor(now/1000),token:cookie.token},{key:'c24f74ca2820225badc01946dba4fdf7',iv:'adc01946dba4fdf7'}),
    t1:encrypt(`${cookie.t1||''}|${now}`,{key:'5e4ef500e9597fe004bd09a46d8add98',iv:'04bd09a46d8add98'}),
    t2:encrypt(`${cookie.KUGOU_API_GUID}|0f607264fc6318a92b9e13c65db7cd3c|${cookie.KUGOU_API_MAC}|${cookie.KUGOU_API_DEV}|${now}`,{key:'fd14b35e3f81af3817a20ae7adae7020',iv:'17a20ae7adae7020'}),
    t3:'MCwwLDAsMCwwLDAsMCwwLDA=',dev:cookie.KUGOU_API_DEV,
    pk:rsa({clienttime_ms:now,key:envelope.key}),params:envelope.str,
  };
  const reply=await request({baseURL:'https://gateway.kugou.com',headers:{'x-router':'login.user.kugou.com'},url:'/v5/login_by_token',method:'POST',data,cookie,encryptType:'android'});
  if(reply.body?.status===1&&reply.body.data?.secu_params){
    const secret=decrypt(reply.body.data.secu_params,envelope.key);
    if(secret&&typeof secret==='object')Object.assign(reply.body.data,secret);
    else if(typeof secret==='string')reply.body.data.token=secret;
  }
  return reply;
}
