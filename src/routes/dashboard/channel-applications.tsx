import { Title } from "@solidjs/meta";

/**
 * 渠道申请审核。
 *
 * 数据来自线上控制台的渠道申请接口（本机没实现），原来这一页渲染的是写死的
 * 申请样例，审核按钮也只是假处理，已经去掉，等接口落地再接。
 */
function DashboardChannelApplications() {
  return <Title>渠道申请 | TokenMP 销售控制台</Title>;
}

export default DashboardChannelApplications;
