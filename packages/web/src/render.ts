/**
 * DOM construction and copy.
 *
 * Every element is built with `createElement` and every value is written with
 * `textContent`. The package contains no markup-string sinks at all: no
 * inner-markup assignment properties, no adjacent-markup insertion, no
 * document-writing call, no eval, and no Function-constructor use. A message
 * body, title, or reference can therefore only ever appear as inert text —
 * remote HTML and JavaScript are data, never authority.
 *
 * Copy is Chinese-first with an English gloss, because the product's first
 * readers are Chinese-speaking and the protocol vocabulary is English.
 *
 * `scripts/smoke.mjs` asserts the no-markup-sink property against the emitted
 * bundle.
 */

import {
  authorshipView,
  deriveActionState,
  factViews,
  formatClock,
  isExpired,
  presentationSummary,
  riskTone,
  type ActionState,
  type ComposeDraft,
  type DecisionRecord,
  type DeviceFacts,
  type Envelope,
  type FactDimension,
  type Intent,
  type Peer,
  type Progress,
  type Risk,
  type SendRecord,
  type Tone,
} from './model.js';

type Child = Node | string | null | undefined;
type Props = Record<string, string | number | boolean | EventListener | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Like `h`, but for appending to an existing node; skips absent children. */
function append(node: Element, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/* ------------------------------------------------------------------ *
 * Copy — Chinese first, English gloss
 * ------------------------------------------------------------------ */

/** Bilingual label: Chinese primary, English as a quieter second line. */
function bi(zh: string, en: string): HTMLElement {
  return h(
    'span',
    { class: 'bi' },
    h('span', { class: 'bi__zh', text: zh }),
    h('span', { class: 'bi__en', lang: 'en', text: en }),
  );
}

const FACT_COPY: Readonly<Record<FactDimension, { zh: string; en: string; note: { zh: string; en: string } }>> = {
  transport: {
    zh: '传输尝试',
    en: 'Transport attempt',
    note: { zh: '本机是否送达对端。与人是否读过无关。', en: 'Whether this device reached the peer. Unrelated to whether anyone read it.' },
  },
  storage: {
    zh: '接收存储',
    en: 'Recipient storage',
    note: { zh: '依赖未满足的事件已被存储，但不能授权任何动作。', en: 'A dependency-pending event is stored but cannot authorize an effect.' },
  },
  delivery: {
    zh: '投递',
    en: 'Delivery',
    note: { zh: '已投递不等于已读。正文是否可用另行记录。', en: 'Delivered never means read. Body availability is tracked separately.' },
  },
  presentation: {
    zh: '呈现',
    en: 'Presentation',
    note: { zh: '按设备分别记录，聚合结果不会声称“所有设备都已读”。', en: 'Kept per device. The aggregate never implies “read on every device”.' },
  },
  acknowledgement: {
    zh: '确认',
    en: 'Acknowledgement',
    note: { zh: '只由显式操作产生；已读不能推导出确认。', en: 'Explicit only. Reading cannot acknowledge.' },
  },
  action: {
    zh: '动作尝试',
    en: 'Action attempt',
    note: { zh: '有独立的批准与执行过程。Agent 可以在未读时先行动作。', en: 'Has its own approval and execution. An Agent may act on unread mail.' },
  },
  delegation: {
    zh: '委托',
    en: 'Delegation',
    note: { zh: '动作开始前会重新校验。过期无法撤销已经发生的外部影响。', en: 'Rechecked when an action starts. Expiry cannot undo a completed external effect.' },
  },
};

const ACTION_COPY: Readonly<Record<ActionState, string>> = {
  requested: '已请求',
  awaiting_approval: '等待批准',
  approved: '已批准',
  executing: '执行中',
  succeeded: '已完成',
  failed: '已失败',
  uncertain: '结果未知',
  rejected: '已拒绝',
  expired: '已过期',
};

const PRESENTATION_COPY: Readonly<Record<string, string>> = {
  unseen: '未呈现',
  presented: '已呈现',
  read: '已读',
};

const INTENT_COPY: Readonly<Record<Intent, string>> = {
  inform: '告知',
  suggest: '建议',
  request: '请求',
  delegate: '委派',
  command: '指令',
};

const RISK_COPY: Readonly<Record<Risk, string>> = {
  low: '低',
  medium: '中',
  high: '高',
};

export function presentationLabel(token: string): string {
  if (token === 'no-device-reported') return '无设备记录';
  const all = /^read:all-(\d+)$/.exec(token);
  if (all) return `全部 ${all[1]} 台设备已读`;
  const some = /^read:(\d+)-of-(\d+)$/.exec(token);
  if (some) return `${some[2]} 台中 ${some[1]} 台已读`;
  const pres = /^presented:(\d+)-of-(\d+)$/.exec(token);
  if (pres) return `${pres[2]} 台中 ${pres[1]} 台已呈现`;
  return '未呈现';
}

/* ------------------------------------------------------------------ *
 * Shared pieces
 * ------------------------------------------------------------------ */

function chip(label: string, tone: Tone = 'neutral', extraClass = ''): HTMLElement {
  return h('span', { class: `chip ${extraClass}`.trim(), 'data-tone': tone, text: label });
}

function authorshipMark(kind: Envelope['actor']['kind']): HTMLElement {
  const view = authorshipView(kind);
  return h('span', { class: 'mark', 'data-kind': kind, text: view.mark, 'aria-hidden': 'true' });
}

const AUTHORSHIP_COPY: Readonly<Record<Envelope['actor']['kind'], { zh: string; en: string }>> = {
  human: { zh: '人', en: 'Human' },
  'agent-delegated': { zh: '受委托 Agent', en: 'Agent · delegated' },
  'agent-autonomous': { zh: '自主 Agent', en: 'Agent · autonomous' },
  system: { zh: '系统', en: 'System' },
};

export function authorshipLabel(kind: Envelope['actor']['kind']): string {
  return AUTHORSHIP_COPY[kind].zh;
}

/* ------------------------------------------------------------------ *
 * Cover card
 * ------------------------------------------------------------------ */

export interface CoverCardModel {
  readonly envelope: Envelope;
  readonly decision: DecisionRecord | null;
  readonly needsDecision: boolean;
  readonly dismissed: boolean;
  readonly selected: boolean;
  readonly now: number;
}

function coverTone(model: CoverCardModel): Tone {
  if (model.dismissed) return 'muted';
  if (model.needsDecision) return 'attention';
  const action = deriveActionState(model.envelope, model.now);
  if (action === 'expired' || action === 'failed' || action === 'rejected') return 'bad';
  if (action === 'succeeded') return 'good';
  return 'neutral';
}

export function coverCard(model: CoverCardModel, onSelect: (id: string) => void): HTMLElement {
  const { envelope } = model;
  const authorship = authorshipView(envelope.actor.kind);
  const action = deriveActionState(envelope, model.now);

  let statusChip: HTMLElement;
  if (model.dismissed) statusChip = chip('已搁置', 'muted');
  else if (model.decision?.status === 'failed') statusChip = chip('决定未提交', 'bad');
  else if (model.decision?.status === 'pending') statusChip = chip('提交中', 'progress');
  else if (model.needsDecision) statusChip = chip('等待你的决定', 'attention');
  else if (action === 'expired') statusChip = chip('已过期', 'bad');
  else if (action === 'succeeded') statusChip = chip('已完成', 'good');
  else statusChip = chip(INTENT_COPY[envelope.semantic.intent]);

  return h(
    'button',
    {
      class: 'cover-card',
      type: 'button',
      'data-tone': coverTone(model),
      'aria-current': model.selected ? 'true' : 'false',
      onclick: () => onSelect(envelope.id),
    },
    h(
      'div',
      { class: 'cover-card__top' },
      authorshipMark(envelope.actor.kind),
      h(
        'div',
        { class: 'grow' },
        h('h3', { class: 'cover-card__title', text: envelope.cover.title }),
        envelope.cover.preview === '' ? null : h('p', { class: 'cover-card__preview', text: envelope.cover.preview }),
      ),
    ),
    h(
      'div',
      { class: 'cover-card__meta' },
      statusChip,
      chip(`${AUTHORSHIP_COPY[envelope.actor.kind].zh}`, authorship.tone === 'attention' ? 'attention' : 'muted'),
      envelope.policy.risk === 'high' ? chip('高风险', 'bad') : null,
      h('span', { class: 'chip', 'data-tone': 'muted', text: formatClock(envelope.receivedAt, model.now) }),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

export interface DetailModel {
  readonly envelope: Envelope;
  readonly decision: DecisionRecord | null;
  readonly needsDecision: boolean;
  readonly dismissed: boolean;
  readonly pendingConfirm: 'approve' | 'reject' | null;
  readonly parentTitle: string | null;
  readonly now: number;
  readonly bodyText?: string | null;
  readonly bodyLoading?: boolean;
  readonly bodyError?: string | null;
}

export interface DetailHandlers {
  readonly onBeginDecision: (intent: 'approve' | 'reject') => void;
  readonly onConfirmDecision: (intent: 'approve' | 'reject') => void;
  readonly onCancelConfirm: () => void;
  readonly onRetryDecision: () => void;
  readonly onDismiss: () => void;
  readonly onUndismiss: () => void;
  readonly onMarkRead: () => void;
  readonly onAcknowledge: () => void;
  readonly onReply: () => void;
  readonly onLoadBody?: () => void;
  readonly onRetryBody?: () => void;
}

function inertReference(label: string, value: string, explanation: string): HTMLElement {
  return h(
    'div',
    { class: 'inert' },
    h('span', { text: `${label} ` }),
    h('code', { text: value }),
    h('span', { text: ` — ${explanation}` }),
  );
}

function factCard(view: ReturnType<typeof factViews>[number]): HTMLElement {
  const copy = FACT_COPY[view.dimension];
  const shown = view.dimension === 'presentation' ? presentationLabel(view.value) : view.value;
  const shownEn = view.dimension === 'presentation' ? view.value : '';
  return h(
    'div',
    { class: 'fact', 'data-tone': view.tone },
    h('div', { class: 'fact__dimension' }, bi(copy.zh, copy.en)),
    h(
      'div',
      { class: 'fact__value' },
      h('span', { text: shown }),
      shownEn === '' ? null : h('span', { class: 'fact__raw', lang: 'en', text: shownEn }),
    ),
    h('p', { class: 'fact__note' }, bi(copy.note.zh, copy.note.en)),
  );
}

/**
 * The decision panel.
 *
 * A decision is a *submission*. Until the node accepts it the action fact does
 * not move, the panel says so, and a failure is shown as a failure with a retry
 * — never as a quiet success. There is no undo, because the node's transition
 * table makes a decided action terminal; offering one would be a claim this
 * client cannot honour.
 */
function decisionPanel(model: DetailModel, handlers: DetailHandlers): HTMLElement {
  const { envelope, decision, needsDecision, pendingConfirm, now } = model;
  const action = deriveActionState(envelope, now);
  const expired = isExpired(envelope, now);

  // Submission failed — say so plainly and offer the retry.
  if (decision?.status === 'failed') {
    return h(
      'div',
      { class: 'decision', 'data-state': 'failed' },
      h(
        'div',
        { class: 'decision__status', 'data-durability': 'failed' },
        h('div', { class: 'grow' }, bi('决定未提交', 'Decision not submitted'), h('p', { text: decision.error ?? '未知错误' })),
        h('button', { class: 'btn btn--primary', type: 'button', text: '重试', title: 'Retry', onclick: handlers.onRetryDecision }),
      ),
    );
  }

  if (decision?.status === 'pending') {
    return h(
      'div',
      { class: 'decision', 'data-state': 'pending' },
      h(
        'div',
        { class: 'decision__status', 'data-durability': 'pending' },
        h('div', { class: 'grow' }, bi('正在提交到本机节点…', 'Submitting to the local node…')),
      ),
    );
  }

  if (decision?.status === 'confirmed') {
    return h(
      'div',
      { class: 'decision', 'data-state': 'settled' },
      h(
        'div',
        { class: 'decision__status', 'data-durability': 'confirmed' },
        h(
          'div',
          { class: 'grow' },
          bi(
            decision.intent === 'approve' ? '已记录：批准' : '已记录：拒绝',
            decision.intent === 'approve' ? 'Recorded: approved' : 'Recorded: rejected',
          ),
          h('p', {
            text: `节点已接受该决定（${formatClock(decision.at, now)}）。动作状态：${ACTION_COPY[action]} / ${action}。`,
          }),
          h('p', { class: 'muted-line', text: '此视图不提供撤销：节点将该动作视为终态，撤销需要新的策略，而不是这里的一次点击。' }),
        ),
      ),
    );
  }

  if (!needsDecision) {
    return h(
      'div',
      { class: 'decision', 'data-state': 'settled' },
      h(
        'div',
        { class: 'decision__status', 'data-durability': 'confirmed' },
        h(
          'div',
          { class: 'grow' },
          bi('无需你决定', 'No decision required'),
          h('p', {
            text:
              action === 'expired'
                ? '策略已使该请求过期。'
                : action === 'uncertain'
                  ? '执行已开始但结果未记录。请人工核对，或仅在具备幂等约定时重试。'
                  : `当前动作状态：${ACTION_COPY[action]} / ${action}。`,
          }),
        ),
      ),
    );
  }

  // Open decision: deliberate approval, cheap safe choice.
  const body = h('div', { class: 'decision__body' });

  if (expired) {
    body.append(
      h('p', { class: 'decision__prompt', text: '该请求已过期，节点会拒绝批准（APPROVAL_EXPIRED）。' }),
      h('div', { class: 'decision__spacer' }),
      h('button', { class: 'btn btn--quiet', type: 'button', text: '搁置', onclick: handlers.onDismiss }),
    );
  } else if (pendingConfirm !== null) {
    const approving = pendingConfirm === 'approve';
    body.append(
      h(
        'div',
        { class: 'confirm', 'data-kind': pendingConfirm },
        h('p', { class: 'confirm__title' }, bi(approving ? '确认批准' : '确认拒绝', approving ? 'Confirm approval' : 'Confirm rejection')),
        h('p', {
          class: 'confirm__detail',
          text: approving
            ? `将向本机节点提交一条批准回执，绑定事件 ${envelope.id}。提交完成前不会显示为已批准；此视图不提供撤销。`
            : `将向本机节点提交一条拒绝回执，绑定事件 ${envelope.id}。拒绝后该动作成为终态。`,
        }),
        h(
          'div',
          { class: 'confirm__actions' },
          h('button', {
            class: approving ? 'btn btn--primary' : 'btn btn--danger',
            type: 'button',
            text: approving ? '确认批准' : '确认拒绝',
            onclick: () => handlers.onConfirmDecision(pendingConfirm),
          }),
          h('button', { class: 'btn btn--quiet', type: 'button', text: '取消', onclick: handlers.onCancelConfirm }),
        ),
      ),
    );
  } else {
    body.append(
      h('button', { class: 'btn btn--primary', type: 'button', text: '批准…', onclick: () => handlers.onBeginDecision('approve') }),
      h('button', { class: 'btn btn--danger', type: 'button', text: '拒绝…', onclick: () => handlers.onBeginDecision('reject') }),
      h('div', { class: 'decision__spacer' }),
      h('button', {
        class: 'btn btn--quiet',
        type: 'button',
        text: '搁置',
        title: '仅本机记录，不会同步',
        onclick: handlers.onDismiss,
      }),
    );
  }

  return h(
    'div',
    { class: 'decision', 'data-state': 'open' },
    h(
      'div',
      { class: 'decision__head' },
      h('h3', {}, bi('这条请求在等待你的决定', 'This request is waiting for your decision')),
      h('p', {
        class: 'decision__prompt',
        text:
          envelope.actor.kind === 'agent-autonomous'
            ? '这是自主 Agent 发来的请求。请先阅读意图与限制，再决定。'
            : '批准会针对这一条确切的事件提交决定。搁置不产生任何网络影响。',
      }),
    ),
    body,
  );
}

export function detailView(model: DetailModel, handlers: DetailHandlers): HTMLElement {
  const { envelope, decision, dismissed, parentTitle, now } = model;
  const authorship = authorshipView(envelope.actor.kind);
  const presentation = presentationSummary(envelope.facts.devices);
  const action = deriveActionState(envelope, now);

  const head = h(
    'header',
    { class: 'detail__head' },
    h(
      'div',
      { class: 'detail__eyebrow' },
      authorshipMark(envelope.actor.kind),
      chip(`${AUTHORSHIP_COPY[envelope.actor.kind].zh} · ${AUTHORSHIP_COPY[envelope.actor.kind].en}`, authorship.tone === 'attention' ? 'attention' : 'progress'),
      chip(`意图 ${INTENT_COPY[envelope.semantic.intent]}`),
      chip(`风险 ${RISK_COPY[envelope.policy.risk]}`, riskTone(envelope.policy.risk)),
      chip(`${ACTION_COPY[action]} · ${action}`),
    ),
    h('h2', { class: 'detail__title', text: envelope.cover.title }),
    envelope.cover.preview === '' ? null : h('p', { class: 'detail__preview', text: envelope.cover.preview }),
    h('div', { class: 'detail__id', text: envelope.id }),
    envelope.originPeerId === null
      ? null
      : h('p', { class: 'detail__id tight warm', text: `来自 Peer ${envelope.originPeerId} · 作者类型未经签名验证` }),
    parentTitle === null
      ? null
      : h('p', { class: 'detail__replyref', text: `引用回复 · 父事件：${parentTitle}` }),
  );

  const facts = h(
    'section',
    { class: 'section' },
    h('h3', { class: 'section__title' }, bi('互相独立的事实', 'Independent facts')),
    h('div', { class: 'facts' }, ...factViews(envelope, now).map(factCard)),
    h('p', {
      class: 'independence-note',
      text: `按设备分别记录：${presentation.total} 台设备中 ${presentation.read} 台已读、${presentation.presented} 台已呈现。这些维度不会合并成单一状态：已投递不等于已读，已读不等于已确认，动作也可以先于阅读发生。`,
    }),
  );

  const policyRows = h(
    'div',
    { class: 'rows' },
    h(
      'div',
      { class: 'row' },
      h('div', { class: 'row__label', text: '批准' }),
      h('div', { class: 'row__value', text: envelope.policy.requiresApproval ? '执行前需要批准' : '无需批准' }),
    ),
    h(
      'div',
      { class: 'row' },
      h('div', { class: 'row__label', text: '过期' }),
      h('div', {
        class: 'row__value',
        text:
          envelope.policy.expiresAt === null
            ? '未设置过期时间'
            : `${new Date(envelope.policy.expiresAt).toISOString()}（${formatClock(envelope.policy.expiresAt, now)}）`,
      }),
    ),
    h(
      'div',
      { class: 'row' },
      h('div', { class: 'row__label', text: '预算' }),
      h('div', {
        class: 'row__value',
        text: `跳数 ≤ ${envelope.policy.hopLimit ?? '—'} · 扇出 ≤ ${envelope.policy.fanoutLimit ?? '—'}`,
      }),
    ),
    h(
      'div',
      { class: 'row' },
      h('div', { class: 'row__label', text: '署名' }),
      h(
        'div',
        { class: 'row__value' },
        h('p', { class: 'tight' }, bi(AUTHORSHIP_DETAIL[envelope.actor.kind].zh, AUTHORSHIP_DETAIL[envelope.actor.kind].en)),
        authorship.notHuman
          ? h('p', { class: 'tight warm' }, bi('此消息不得被呈现为人所写。', 'This envelope must never be shown as human-authored.'))
          : null,
        envelope.actor.delegatorId === null
          ? null
          : h('p', { class: 'detail__id tight', text: `委托方 ${envelope.actor.delegatorId} · 撰写 ${envelope.actor.composerId ?? envelope.actor.id}` }),
      ),
    ),
  );

  const remoteBody = envelope.bodyObjectId === null
    ? null
    : model.bodyLoading
      ? h('p', { class: 'row__value--quote', text: '正在按需抓取正文… Loading body on demand…' })
      : model.bodyText !== undefined && model.bodyText !== null
        ? h('div', { class: 'rows' }, h('div', { class: 'row' }, h('div', { class: 'row__label', text: '正文 · body' }), h('div', { class: 'row__value row__value--quote', text: model.bodyText })))
        : h('div', { class: 'body-fetch' },
          h('p', { class: 'row__value--quote', text: model.bodyError ?? '正文尚未抓取。封面可先离线阅读。' }),
          handlers.onLoadBody === undefined ? null : h('button', { class: 'btn btn--small', type: 'button', text: model.bodyError ? '重试正文' : '展开正文', onclick: model.bodyError ? handlers.onRetryBody : handlers.onLoadBody }),
        );

  const content = h(
    'section',
    { class: 'section' },
    h('h3', { class: 'section__title' }, bi('内容与引用', 'Content and references')),
    envelope.inlineBody !== null
      ? h('div', { class: 'rows' }, h('div', { class: 'row' }, h('div', { class: 'row__label', text: '正文' }), h('div', { class: 'row__value row__value--quote', text: envelope.inlineBody })))
      : remoteBody ?? h('p', { class: 'row__value--quote', text: '没有正文对象。此处单独显示封面。' }),
    envelope.parents.length === 0
      ? null
      : inertReference('父事件 · parent', envelope.parents[0]!, '仅作为引用显示，不抓取、不执行'),
    envelope.bodyObjectId === null
      ? null
      : inertReference('正文对象 · body', envelope.bodyObjectId, '仅在请求时抓取，并按哈希校验'),
    envelope.surfaceRef === null
      ? null
      : inertReference('界面 · surface', `${envelope.surfaceRef.surfaceId} v${envelope.surfaceRef.version}`, '只从允许列表渲染，绝不在此执行'),
    envelope.semantic.contextRefs.length === 0
      ? null
      : h(
          'div',
          { class: 'refs' },
          ...envelope.semantic.contextRefs.map((ref) => chip(ref)),
        ),
  );

  const actions = h(
    'section',
    { class: 'section' },
    h('h3', { class: 'section__title' }, bi('独立操作', 'Independent actions')),
    h(
      'div',
      { class: 'action-row' },
      h('button', {
        class: 'btn btn--small',
        type: 'button',
        text: '标记为已读',
        title: '提交 read 回执，不影响确认或动作状态',
        onclick: handlers.onMarkRead,
      }),
      h('button', {
        class: 'btn btn--small',
        type: 'button',
        text: '已确认收到',
        title: '提交 acknowledged 回执',
        onclick: handlers.onAcknowledge,
      }),
      h('button', { class: 'btn btn--small', type: 'button', text: '回复', onclick: handlers.onReply }),
      h('div', { class: 'decision__spacer' }),
      dismissed
        ? h('button', { class: 'btn btn--quiet btn--small', type: 'button', text: '取消搁置', onclick: handlers.onUndismiss })
        : null,
    ),
    h('p', { class: 'muted-line', text: '已读与确认是两个独立事实：标记已读不会确认，确认也不会改变动作状态。' }),
  );

  return h('article', {}, head, facts, h('section', { class: 'section' }, h('h3', { class: 'section__title' }, bi('策略与来源', 'Policy and provenance')), policyRows), content, actions, decisionPanel(model, handlers));
}

const AUTHORSHIP_DETAIL: Readonly<Record<Envelope['actor']['kind'], { zh: string; en: string }>> = {
  human: { zh: '由人撰写并发出。', en: 'Written and sent by a person.' },
  'agent-delegated': {
    zh: '在人类委托下撰写或发出。动作开始前会重新校验委托，委托可能已过期或被撤销。',
    en: 'Written or sent under a human delegation, rechecked before any action starts.',
  },
  'agent-autonomous': {
    zh: '由 Agent 按其本地策略生成。签名只证明对密钥的控制，不证明有人写下这段话。',
    en: 'Created under an Agent’s own policy. A signature proves key control, not that a person typed it.',
  },
  system: { zh: '由节点为传输或同步生成，不携带人或 Agent 的署名。', en: 'Produced by a node for transport or synchronization.' },
};

/* ------------------------------------------------------------------ *
 * Compose
 * ------------------------------------------------------------------ */

export interface ComposeModel {
  readonly peers: Peer[];
  readonly peersAvailable: boolean;
  readonly draft: ComposeDraft;
  readonly replyTo: { eventId: string; title: string } | null;
  readonly sending: boolean;
  readonly lastError: string | null;
}

export interface ComposeHandlers {
  readonly onField: (patch: Partial<ComposeDraft>) => void;
  readonly onSubmit: () => void;
  readonly onCancelReply: () => void;
  readonly onReloadPeers: () => void;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field__label', text: label }),
    control,
    hint === undefined ? null : h('span', { class: 'field__hint', text: hint }),
  );
}

/**
 * Why the peer selector is empty. "The node has no peers configured" and "this
 * node does not answer /v1/peers" are different problems with different fixes,
 * so they get different words.
 */
function peerHint(model: ComposeModel): string | undefined {
  if (!model.peersAvailable) return '此节点尚未提供 GET /v1/peers，无法在此选择对端。';
  if (model.peers.length === 0) return '节点已连接，但尚未配置任何对端；请先在节点侧完成配对，再从这里发送。';
  return undefined;
}

/** A native select, so keyboard and screen-reader behaviour comes for free. */
function peerSelect(model: ComposeModel, handlers: ComposeHandlers): HTMLElement {
  const select = h('select', {
    class: 'input',
    id: 'compose-peer',
    onchange: (event: Event) => {
      const value = (event.target as HTMLSelectElement).value;
      handlers.onField({ peerId: value });
    },
  }) as HTMLSelectElement;

  if (!model.peersAvailable) {
    select.append(h('option', { value: '', text: '对端目录不可用 / peer directory unavailable' }));
    select.disabled = true;
    return select;
  }
  if (model.peers.length === 0) {
    select.append(h('option', { value: '', text: '尚无已配对的对端 / no paired peers' }));
    select.disabled = true;
    return select;
  }
  select.append(h('option', { value: '', text: '选择对端…' }));
  for (const peer of model.peers) {
    const option = h('option', { value: peer.peerId, text: `${peer.label} · ${peer.peerId}` }) as HTMLOptionElement;
    if (peer.peerId === model.draft.peerId) option.selected = true;
    select.append(option);
  }
  return select;
}

export function composeView(model: ComposeModel, handlers: ComposeHandlers): HTMLElement {
  const { draft } = model;

  const titleInput = h('input', {
    class: 'input',
    id: 'compose-title',
    type: 'text',
    maxlength: '160',
    value: draft.title,
    placeholder: '一句话说明这条消息要做什么',
    oninput: (event: Event) => handlers.onField({ title: (event.target as HTMLInputElement).value }),
  });

  const previewInput = h('input', {
    class: 'input',
    id: 'compose-preview',
    type: 'text',
    maxlength: '400',
    value: draft.preview,
    placeholder: '收件人在不打开正文时看到的一行摘要',
    oninput: (event: Event) => handlers.onField({ preview: (event.target as HTMLInputElement).value }),
  });

  const bodyInput = h('textarea', {
    class: 'input input--area',
    id: 'compose-body',
    rows: '6',
    maxlength: '4000',
    placeholder: '正文以纯文本呈现，不会被解释为标记。',
    oninput: (event: Event) => handlers.onField({ body: (event.target as HTMLTextAreaElement).value }),
  }) as HTMLTextAreaElement;
  bodyInput.value = draft.body;

  const intentSelect = h('select', {
    class: 'input',
    id: 'compose-intent',
    onchange: (event: Event) => handlers.onField({ intent: (event.target as HTMLSelectElement).value as Intent }),
  }) as HTMLSelectElement;
  for (const intent of ['inform', 'suggest', 'request', 'delegate', 'command'] as const) {
    const option = h('option', { value: intent, text: `${INTENT_COPY[intent]} · ${intent}` }) as HTMLOptionElement;
    if (intent === draft.intent) option.selected = true;
    intentSelect.append(option);
  }

  const riskSelect = h('select', {
    class: 'input',
    id: 'compose-risk',
    onchange: (event: Event) => handlers.onField({ risk: (event.target as HTMLSelectElement).value as Risk }),
  }) as HTMLSelectElement;
  for (const risk of ['low', 'medium', 'high'] as const) {
    const option = h('option', { value: risk, text: `${RISK_COPY[risk]} · ${risk}` }) as HTMLOptionElement;
    if (risk === draft.risk) option.selected = true;
    riskSelect.append(option);
  }

  const approvalInput = h('input', {
    type: 'checkbox',
    id: 'compose-approval',
    onchange: (event: Event) => handlers.onField({ requiresApproval: (event.target as HTMLInputElement).checked }),
  }) as HTMLInputElement;
  approvalInput.checked = draft.requiresApproval;

  const sendable = draft.peerId.trim() !== '' && draft.title.trim() !== '' && !model.sending;

  return h(
    'section',
    { class: 'compose' },
    h('h2', { class: 'compose__title' }, bi('撰写消息', 'Compose')),
    model.replyTo === null
      ? null
      : h(
          'div',
          { class: 'reply-banner' },
          h('div', { class: 'grow' }, bi('引用回复', 'Reply quoting'), h('p', { class: 'tight', text: model.replyTo.title })),
          h('button', { class: 'btn btn--quiet btn--small', type: 'button', text: '取消引用', onclick: handlers.onCancelReply }),
        ),
    h(
      'form',
      {
        class: 'form',
        onsubmit: (event: Event) => {
          event.preventDefault();
          if (sendable) handlers.onSubmit();
        },
      },
      field('对端 · peer', peerSelect(model, handlers), peerHint(model)),
      model.peersAvailable
        ? null
        : field(
            '手动输入对端 ID · manual peer id',
            h('input', {
              class: 'input',
              type: 'text',
              maxlength: '200',
              value: draft.peerId,
              placeholder: 'peer:…',
              oninput: (event: Event) => handlers.onField({ peerId: (event.target as HTMLInputElement).value }),
            }),
            '目录不可用时的回退输入；仍然写入同一字段。',
          ),
      field('标题 · title', titleInput, '封面必须能独立阅读。'),
      field('摘要 · preview', previewInput),
      field('正文 · body', bodyInput, '正文只作为纯文本呈现。'),
      h(
        'div',
        { class: 'form__row' },
        field('意图 · intent', intentSelect),
        field('风险 · risk', riskSelect),
      ),
      h(
        'label',
        { class: 'checkbox' },
        approvalInput,
        h('span', {}, bi('需要接收方批准', 'Recipient approval required')),
      ),
      model.lastError === null
        ? null
        : h('p', { class: 'form__error', role: 'alert', text: `发送失败：${model.lastError}` }),
      h(
        'div',
        { class: 'form__actions' },
        h('button', { class: 'btn btn--primary', type: 'submit', disabled: !sendable, text: model.sending ? '发送中…' : '发送' }),
        h('button', { class: 'btn btn--quiet', type: 'button', text: '重新加载对端', onclick: handlers.onReloadPeers }),
      ),
    ),
    h('p', { class: 'muted-line', text: '事件 ID 由节点根据规范化内容推导；本客户端只负责生成新的 nonce 与 commandId，不自行命名事件。' }),
  );
}

/* ------------------------------------------------------------------ *
 * Outbox
 * ------------------------------------------------------------------ */

const SEND_COPY: Readonly<Record<SendRecord['status'], { zh: string; tone: Tone }>> = {
  queued: { zh: '本机排队中', tone: 'attention' },
  sending: { zh: '发送中', tone: 'progress' },
  sent: { zh: '节点已接收', tone: 'good' },
  failed: { zh: '发送失败', tone: 'bad' },
};

export function outboxView(records: readonly SendRecord[], onRetry: (commandId: string) => void): HTMLElement | null {
  if (records.length === 0) return null;
  const rows = records.slice(0, 8).map((record) => {
    const copy = SEND_COPY[record.status];
    return h(
      'div',
      { class: 'outbox__row', 'data-status': record.status },
      h('span', { class: 'chip', 'data-tone': copy.tone, text: copy.zh }),
      h('span', { class: 'outbox__title', text: record.title }),
      h('span', { class: 'outbox__peer', text: `→ ${record.peerId}` }),
      // The node's own delivery value, shown verbatim rather than translated
      // into a claim this client cannot check.
      record.nodeDelivery === null ? null : h('span', { class: 'outbox__peer', text: `节点投递：${record.nodeDelivery}` }),
      record.error === null ? null : h('span', { class: 'outbox__error', text: record.error }),
      record.status === 'failed' || record.status === 'queued'
        ? h('button', { class: 'btn btn--quiet btn--small', type: 'button', text: '重试', onclick: () => onRetry(record.commandId) })
        : null,
    );
  });
  return h(
    'section',
    { class: 'outbox' },
    h('h3', { class: 'section__title' }, bi('发件箱', 'Outbox')),
    ...rows,
  );
}

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

export function emptyDetail(): HTMLElement {
  return h(
    'div',
    { class: 'detail__empty' },
    h('h2', {}, bi('未选择消息', 'Nothing selected')),
    h('p', { text: '选择左侧的封面开始阅读。正文只在你请求时才抓取。' }),
  );
}

export function connectionPill(state: 'online' | 'offline' | 'checking', label: string): HTMLElement {
  const text = state === 'online' ? '节点已连接' : state === 'checking' ? '正在连接节点' : '未连接节点';
  return h(
    'div',
    { class: 'connection', 'data-state': state, title: label },
    h('span', { class: 'connection__dot', 'aria-hidden': 'true' }),
    h('span', { text }),
    h('span', { class: 'connection__label', text: label }),
  );
}

export function progressBar(progress: Progress): HTMLElement {
  const actionable = progress.decided + progress.open + progress.deferred;
  return h(
    'div',
    { class: 'progress', role: 'group', 'aria-label': '决定进度' },
    h('div', { class: 'progress__bar' }, h('div', { class: 'progress__fill', style: `width:${progress.percent}%` })),
    h(
      'span',
      { class: 'progress__text' },
      h('strong', { text: `${progress.decided}/${actionable}` }),
      ' 已决定',
      progress.open > 0 ? ` · ${progress.open} 待处理` : ' · 全部处理完',
      progress.deferred > 0 ? ` · ${progress.deferred} 已搁置` : '',
    ),
  );
}

export function banner(tone: Tone, title: string, lines: readonly string[], action?: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'banner', 'data-tone': tone },
    h(
      'div',
      { class: 'banner__body' },
      h('strong', { text: title }),
      ...lines.map((line) => h('p', { text: line })),
    ),
    action ?? null,
  );
}

export function liveRegion(message: string): HTMLElement {
  return h('div', { class: 'live', role: 'status', 'aria-live': 'polite', text: message });
}

export function themeButton(theme: 'light' | 'dark', onToggle: () => void): HTMLElement {
  return h('button', {
    class: 'btn btn--small',
    type: 'button',
    text: theme === 'dark' ? '☾ 夜' : '☀ 昼',
    title: '切换主题 / toggle theme',
    'aria-label': `切换到${theme === 'dark' ? '亮' : '暗'}色主题`,
    onclick: onToggle,
  });
}

export function notificationButton(status: 'unsupported' | 'default' | 'granted' | 'denied', onEnable: () => void): HTMLElement {
  const label = status === 'granted' ? '通知已开' : status === 'denied' ? '通知被拒' : status === 'unsupported' ? '无桌面通知' : '开启通知';
  return h('button', {
    class: 'btn btn--small',
    type: 'button',
    text: label,
    title: '只在本机节点出现新信封时通知，不改变消息状态',
    disabled: status === 'unsupported' || status === 'denied' || status === 'granted',
    onclick: onEnable,
  });
}
