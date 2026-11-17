import engine from '../vendor-extra/lua.mjs';
const {lua,lauxlib,lualib,to_luastring}=engine;
self.onmessage=({data:source})=>{
  let state;
  try{
    if(source.length>100000)throw Error('程序过长。');
    state=lauxlib.luaL_newstate();
    lualib.luaL_openlibs(state);
    for(const name of ['os','io','package','require','dofile','loadfile','debug']){
      lua.lua_pushnil(state);lua.lua_setglobal(state,to_luastring(name));
    }
    const lines=[];
    lua.lua_pushcfunction(state, L=>{
      const values=[];
      for(let i=1;i<=lua.lua_gettop(L);i++){
        const text=lauxlib.luaL_tolstring(L,i);
        values.push(text?engine.to_jsstring(text):'');
        lua.lua_pop(L,1);
      }
      if(lines.length>=500)throw Error('输出超过 500 行。');
      lines.push(values.join('\t'));
      return 0;
    });
    lua.lua_setglobal(state,to_luastring('print'));
    if(lauxlib.luaL_dostring(state,to_luastring(source))!==lua.LUA_OK)throw Error(lua.lua_tojsstring(state,-1));
    self.postMessage({text:lines.join('\n')});
  }catch(error){self.postMessage({error:error.message});}
  finally{if(state)lua.lua_close(state);}
};
