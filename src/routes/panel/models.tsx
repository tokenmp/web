import { Title } from "@solidjs/meta";

import { EmptyState } from "~/components/ui/empty-state";

/**
 * 模型目录。
 *
 * 数据来自 GET /user/catalog，本机还没实现（openapi 里标的是 remote），
 * 所以这一页只有空态。原来渲染的是写死的模型与渠道样例，
 * 看着像真数据，实际点不了也调不通，已经去掉。
 */
function PanelModels() {
  return (
    <>
      <Title>模型目录 | TokenMP 用户面板</Title>
      <EmptyState description="接口接上后这里会列出可用模型与上游" />
    </>
  );
}

// 默认导出写在末尾：`export default function X()` 会被 oxc-parser 误判成类型导出，
// 路由扫描把这一条悄悄丢掉（页面直接 404，构建里一句警告都没有）。
export default PanelModels;
