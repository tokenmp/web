import { Title } from "@solidjs/meta";

/**
 * 渠道分组。
 *
 * 数据来自线上控制台的渠道组接口（/admin/channel-groups 一组在本机没实现），
 * 原来这一页渲染的是 demoGroups 这份写死的样例，已经去掉，等接口落地再接。
 */
function DashboardChannelGroups() {
  return <Title>渠道分组 | TokenMP 销售控制台</Title>;
}

export default DashboardChannelGroups;
