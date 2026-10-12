import { Title } from "@solidjs/meta";

/**
 * 渠道管理。
 *
 * 数据来自线上控制台的渠道接口（/admin/channels 一组在本机没实现），
 * 原来这一页渲染的是 demoChannels 这份写死的样例，已经去掉，等接口落地再接。
 */
function DashboardChannels() {
  return <Title>渠道 | TokenMP 销售控制台</Title>;
}

export default DashboardChannels;
