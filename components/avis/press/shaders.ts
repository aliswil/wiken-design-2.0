// Sheet coordinates: page width = 1, y down, z towards the viewer. The clip z is
// planar in screen space and keeps z=0 at the far plane; w gives x' = x·D/(D−z).
export const PAGE_VS = `#version 300 es
layout(location=0) in vec3 aP;
layout(location=1) in vec3 aN;
layout(location=2) in float aL;
layout(location=3) in vec2 aU;
uniform vec2 uView,uEye;
uniform vec3 uAt;
uniform float uD;
out vec2 vU;
out vec3 vN;
out float vL;
out float vZ;
void main(){
vec3 p=aP*uAt.z+vec3(uAt.xy,0.);
float w=1.-p.z/uD;
vec2 c=(uEye*(w-1.)+p.xy)*2./uView-w;
gl_Position=vec4(c.x,-c.y,4.*w-3.,w);
vU=aU;vN=aN;vL=aL;vZ=aP.z;
}`;

export const PAGE_FS = `#version 300 es
precision highp float;
uniform sampler2D uF,uB,uOld,uGrain,uShade;
uniform vec2 uSize,uRes;
uniform vec3 uPaper;
uniform float uPrint,uCast;
in vec2 vU;
in vec3 vN;
in float vL;
in float vZ;
out vec4 color;
const vec3 L=vec3(-.39,-.5,.773);
const vec3 Y=vec3(.299,.587,.114);
bool F;
vec3 T(vec2 s){return F?texture(uF,s).rgb:texture(uB,s).rgb;}
float dots(float ink,vec2 p,float a,float aa){
float x=cos(a),y=sin(a);
vec2 q=mat2(x,-y,y,x)*p/3.5;
return 1.-smoothstep(-aa,aa,length(fract(q)-.5)-sqrt(max(ink,0.))*.72);
}
void main(){
F=gl_FrontFacing;
vec2 s=F?vU:vec2(1.-vU.x,vU.y);
vec2 p=s*uSize;
float aa=length(fwidth(p))/3.5+.001;
float l=max(vL,1.-uPrint);
vec3 c;
if(l>.001){
vec2 d=vec2(l*.004,l*.0024);
c=vec3(T(s+d).r,T(s).g,T(s-d).b);
if(uPrint<1.){
vec3 a=texture(uOld,s).rgb;
c=vec3(mix(a.r,c.r,smoothstep(0.,.6,uPrint)),mix(a.g,c.g,smoothstep(.2,.8,uPrint)),mix(a.b,c.b,smoothstep(.4,1.,uPrint)));
}else{
vec3 ink=1.-c/uPaper;
vec3 h=uPaper*(1.-vec3(dots(ink.r,p,.262,aa),dots(ink.g,p,1.309,aa),dots(ink.b,p,0.,aa)));
c=mix(c,h,smoothstep(0.,1.,l)*.42);
}
}else c=T(s);
vec3 n=normalize(F?vN:-vN);
vec2 g=p/256.;
float grain=texture(uGrain,g).r;
float up=clamp(vZ*8.,0.,1.);
if(up>0.)n=normalize(n+up*.05*vec3(grain-texture(uGrain,g+vec2(.004,0.)).r,grain-texture(uGrain,g+vec2(0.,.004)).r,0.));
float sh=clamp(1.+.3*(dot(n,L)-L.z),.74,1.08);
c*=sh*mix(vec3(1.),vec3(1.03,1.,.95),max(1.-sh,0.)*3.);
c*=1.+(grain-.5)*.022;
c*=1.-.13*exp(-vU.x/.03);
float f=(vU.y-.5)/.005;
c*=1.-.022*exp(-f*f);
float t=up*(.07+.14*clamp(1.-dot(n,L)*1.3,0.,1.));
if(t>.002){
vec2 b=F?vec2(1.-vU.x,vU.y):vU;
vec3 k=F?texture(uB,b).rgb:texture(uF,b).rgb;
c*=mix(1.,min(dot(k,Y)/dot(uPaper,Y),1.),t);
}
if(uCast>0.)c*=1.-uCast*texture(uShade,gl_FragCoord.xy/uRes).r;
color=vec4(c,1.);
}`;

export const FLAT_VS = `#version 300 es
uniform vec2 uView;
uniform vec4 uRect;
uniform float uSoft;
out vec2 vP;
void main(){
vec2 q=vec2(gl_VertexID&1,gl_VertexID>>1);
vP=mix(uRect.xy-uSoft,uRect.zw+uSoft,q);
vec2 c=vP*2./uView-1.;
gl_Position=vec4(c.x,-c.y,0.,1.);
}`;

export const FLAT_FS = `#version 300 es
precision highp float;
uniform sampler2D uShade;
uniform vec4 uRect,uTint;
uniform vec2 uRes;
uniform float uSoft,uUseShade;
in vec2 vP;
out vec4 color;
void main(){
vec2 d=max(max(uRect.xy-vP,vP-uRect.zw),0.);
float a=uTint.a*(1.-smoothstep(0.,max(uSoft,.5),length(d)));
if(uUseShade>0.)a*=texture(uShade,gl_FragCoord.xy/uRes).r;
color=vec4(uTint.rgb*a,a);
}`;
