import { Title } from "@solidjs/meta";

/**
 * 我的账号（共享上游账号换分成）。
 *
 * 数据与操作都在线上接口上（/user/accounts 一组在本机没实现），
 * 原来这一页渲染的是写死的账号样例，新增与编辑走了也是本地假写入，
 * 已经去掉，等接口落地再接。
 */
function PanelAccounts() {
  return <Title>我的账号 | TokenMP 用户面板</Title>;
}

export default PanelAccounts;
