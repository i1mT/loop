import type { ProjectItem } from "../types.ts";
import type { ProjectBinding } from "./bindings.ts";
export function projectBindings(project: ProjectItem): ProjectBinding[] {
  return project.bindings ?? (project.machine_id?[{machineId:project.machine_id,localPath:project.local_path,agent:project.agent??"",model:null,effort:null}]:[]);
}
export function projectHasMachine(project: ProjectItem,id:string):boolean{return projectBindings(project).some(binding=>binding.machineId===id);}
/** 项目里配置了哪些智能体（去重），用于列表和概览展示 */
export function bindingAgents(bindings: ProjectBinding[]): string[] {
  return [...new Set(bindings.map(binding=>binding.agent).filter(Boolean))];
}
