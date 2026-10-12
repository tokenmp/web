import { Title } from "@solidjs/meta";

/**
 * 我的渠道（分享渠道申请与渠道组）。
 *
 * 数据与操作都在线上接口上（/user/channel-applications 与 /user/channel-groups
 * 在本机没实现），原来这一页渲染的是写死的申请与渠道组样例，提交也只是假写入，
 * 已经去掉，等接口落地再接。
 */
function PanelChannels() {
  return <Title>我的渠道 | TokenMP 用户面板</Title>;
}

export default PanelChannels;
