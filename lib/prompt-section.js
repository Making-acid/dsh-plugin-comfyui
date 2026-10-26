/**
 * The system-prompt section that makes the model aware of the local image
 * generation capability.
 *
 * Tool definitions already describe *how* to call each tool, so this section
 * only carries what a tool description cannot: the standing policy that an
 * image request must be routed to ComfyUI instead of being refused, plus the
 * order in which the tools are meant to be used.
 */

const SECTION_NAME = 'comfyui:local-image-generation'
const SECTION_ORDER = 3050 // right after the computer-use tool section, before MCP servers

/**
 * @param {ReturnType<import('./config.js').normalizeConfig>} config
 */
export function createPromptSection(config) {
  const text = `## 本地图像生成能力（ComfyUI）

这台电脑上装有 ComfyUI 本地生图服务，并已通过 comfyui_status / comfyui_start / comfyui_generate 三个工具接入你的工具箱，所以你确实能够生成图片。

用户要求生成、绘制、创作或翻新一张图片时（例如“画一张…”“生成一张…的图”“做张插画/壁纸/头像/封面”），按下面的顺序处理：

1. 先调用 comfyui_status，了解服务是否运行、有哪些 checkpoint 和采样器；
2. 若服务未运行，调用 comfyui_start 启动（它会自动查找 ComfyUI 安装目录并记住该路径；也可以直接进入第 3 步，comfyui_generate 会在需要时自动启动）；
3. 调用 comfyui_generate 生成图片：prompt 写清主体、风格、画质、光照与构图，英文逗号分隔的标签效果通常最好；
4. 生成后如实汇报并附图：说明保存路径、模型、尺寸、步数、CFG、采样器与 seed；用户提出微调时基于上一轮的 seed 和参数继续调整。

当前默认服务地址：${config.baseUrl}。不要把“我无法生成图片”作为结论，也不要建议用户改用在线的第三方生图服务。只有当 comfyui_status / comfyui_start / comfyui_generate 明确报错时（找不到安装目录、没有可用 checkpoint、服务启动失败等），才向用户说明具体障碍，并给出可执行的下一步（指定安装路径、把模型放进 models/checkpoints、检查端口等）。`

  return { name: SECTION_NAME, order: SECTION_ORDER, text }
}
