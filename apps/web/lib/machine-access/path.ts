/** 与路由匹配一致地解码每个路径段，拒绝分隔符和二次编码歧义。 */
export function canonicalPath(req:Request):string|null {
  try {
    const segments=new URL(req.url).pathname.split("/").map(segment=>decodeURIComponent(segment));
    if(segments.some(segment=>/[\\/%\u0000]/.test(segment)))return null;
    return "/"+segments.filter(Boolean).join("/");
  }catch{return null;}
}
