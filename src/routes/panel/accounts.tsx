import { Title } from "@solidjs/meta";

import { EmptyState } from "~/components/ui/empty-state";

/**
 * 我的账号（共享上游账号换分成）。
 *
 * 数据与操作都在线上接口上（/user/accounts 一组在本机没实现），
 * 原来渲染的是写死的账号样例，新增与编辑也是假写入，已经去掉。
 */
function PanelAccounts() {
  return (
    <>
      <Title>我的账号 | TokenMP 用户面板</Title>
      <EmptyState description="接口接上后这里会列出你分享的账号与分成" />
    </>
  );
}

export default PanelAccounts;
