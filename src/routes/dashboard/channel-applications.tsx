import { Title } from "@solidjs/meta";

import { EmptyState } from "~/components/ui/empty-state";

/**
 * 渠道申请审核。
 *
 * 数据来自线上控制台的渠道申请接口（本机没实现），原来渲染的是写死的申请样例，
 * 审核按钮也只是假处理，已经去掉。
 */
function DashboardChannelApplications() {
  return (
    <>
      <Title>渠道申请 | tokenmp web</Title>
      <EmptyState description="接口接上后这里会列出待处理的渠道申请" />
    </>
  );
}

export default DashboardChannelApplications;
