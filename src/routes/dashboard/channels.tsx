import { Title } from "@solidjs/meta";

import { EmptyState } from "~/components/ui/empty-state";

/**
 * 渠道管理。
 *
 * 数据来自线上控制台的渠道接口（/admin/channels 一组在本机没实现），
 * 原来渲染的是 demoChannels 这份写死的样例，已经去掉。
 */
function DashboardChannels() {
  return (
    <>
      <Title>渠道 | TokenMP 销售控制台</Title>
      <EmptyState description="接口接上后这里会列出渠道、余额与成功率" />
    </>
  );
}

export default DashboardChannels;
