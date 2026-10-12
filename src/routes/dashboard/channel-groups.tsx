import { Title } from "@solidjs/meta";

import { EmptyState } from "~/components/ui/empty-state";

/**
 * 渠道分组。
 *
 * 数据来自线上控制台的渠道组接口（/admin/channel-groups 一组在本机没实现），
 * 原来渲染的是 demoGroups 这份写死的样例，已经去掉。
 */
function DashboardChannelGroups() {
  return (
    <>
      <Title>渠道分组 | TokenMP 销售控制台</Title>
      <EmptyState description="接口接上后这里会列出渠道分组与分流策略" />
    </>
  );
}

export default DashboardChannelGroups;
