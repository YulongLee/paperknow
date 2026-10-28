import {pptMasterDesignPlan} from '../../backend/ppt-master-model.mjs';
export function visualFixture(){
 const content=[['基于图像识别的研究汇报','合成资料 · 仅验证演示功能\n模型方法与研究设计','cover'],['图像识别处理流程','图像采集：读取授权图像，核对样本标签\n图像预处理：统一尺寸，按原始类别划分样本\n模型识别：提取图像特征并输出类别','content'],['系统总体架构','数据模块：管理已授权的图像与标签\n识别模块：加载模型并完成特征提取\n展示模块：显示类别与原始识别记录','content'],['方案对比','方案甲：保留原始输入，在本地执行识别\n方案乙：统一预处理，按相同数据评估','twoColumn'],['合成评估数据','模型甲：82.5%\n模型乙：91.2%\n模型丙：0%','content'],['研究重点与边界','来源核对：确认样本和引用材料的来源\n结果解释：只解释已有数据，不增添结论\n误差分析：对原始记录中的错误进行分类','content'],['下一步安排','整理数据：核对原始样本与标签的一致性\n复核记录：检查模型输出与研究记录','content'],['总结与交流','围绕真实材料呈现方法、结构与证据\n感谢聆听，欢迎交流','closing']];
 const slides=content.map(([title,body,layout],i)=>({id:'slide-'+(i+1),title,body,layout,notes:'合成验收资料，不用于真实研究结论。'})),value={operation:'ppt',snapshot:{title:slides[0].title,language:'中文',context:{pages:8,theme:'academic',author:'合成验收'},materials:[]}};return{value,slides,plan:pptMasterDesignPlan(value,slides)};
}
