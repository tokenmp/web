import { createMemo, createSignal, For, Show } from "solid-js";

import { DecimalSplit } from "~/components/ui/decimal-split";
import { EmptyState } from "~/components/ui/empty-state";
import { modelColor } from "~/lib/model-colors";
import type { UsageSeriesItem } from "~/lib/usage";
import { formatNumber, formatPoints, formatTokens } from "~/lib/utils";

const WIDTH = 640;
const HEIGHT = 200;
/** 每根柱子两侧各留的空隙，柱子之间才看得出是两天 */
const GAP = 8;

/**
 * 近 7 日用量。按模型堆叠的柱状图，手写 SVG —— 控制台的趋势图也是手写，
 * 为了几张图引一个图表库不划算。
 *
 * 交互只有一处：鼠标停在哪一天，就给那天的柱顶盖一条浅色底、并在上方浮出
 * 当天的分模型明细。明细是 HTML 而不是 SVG 文本 —— 深色模式下跟着令牌走，
 * 也不用自己算位置。
 */
/**
 * 序列里出现过的模型，顺序决定堆叠次序与配色下标。
 *
 * 按首次出现的先后收，不按用量排序：换指标或者新的一天进来时，
 * 已出现过的模型不会换颜色。
 */
function usageModels(series: UsageSeriesItem[]) {
  const seen: string[] = [];
  for (const day of series) {
    for (const slice of day.models ?? []) {
      if (!seen.includes(slice.model)) seen.push(slice.model);
    }
  }
  return seen;
}

/**
 * props.loading 与 props.error 只用来选空态那一句。
 * 取数失败时 props.series 也是空的，不区分的话「接口挂了」会显示成
 * 「这段时间还没有产生调用」—— 一句与事实相反的话。重试入口在页头那块 ErrorState 上。
 */
export function UsageChart(props: {
  series: UsageSeriesItem[];
  metric: "tokens" | "revenue";
  loading?: boolean;
  error?: string;
}) {
  const [hovered, setHovered] = createSignal<number | null>(null);

  const models = createMemo(() => usageModels(props.series));
  const valueOf = (day: UsageSeriesItem, model: string) =>
    props.metric === "tokens"
      ? (day.models?.find(slice => slice.model === model)?.tokens ?? 0)
      : (day.models?.find(slice => slice.model === model)?.revenue ?? 0);

  const totals = createMemo(() =>
    props.series.map(day =>
      models().reduce((sum, model) => sum + valueOf(day, model), 0),
    ),
  );
  const peak = createMemo(() => Math.max(1, ...totals()));

  const columnWidth = () => WIDTH / Math.max(1, props.series.length);
  const barHeight = (value: number) => (value / peak()) * (HEIGHT - 8);

  /** 一天里各模型的分块，从下往上排好：给 y 是分块顶边 */
  const segments = (dayIndex: number) => {
    const day = props.series[dayIndex];
    let stacked = 0;
    return models().map(model => {
      const value = valueOf(day, model);
      const height = barHeight(value);
      const y = HEIGHT - stacked - height;
      stacked += height;
      return { model, value, height, y };
    });
  };

  return (
    <Show
      when={props.series.length > 0}
      fallback={
        <EmptyState
          title={props.loading ? "正在加载…" : props.error ? "用量没取到" : "暂无用量"}
          description={
            props.loading || props.error ? undefined : "这段时间还没有产生调用"
          }
        />
      }
    >
      <div class="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          class="h-40 w-full md:h-52"
          role="img"
          aria-label={`近 ${props.series.length} 日用量，按模型分块`}
        >
          {/* 三条水平参考线，让柱高有个参照 */}
          <For each={[0.25, 0.5, 0.75]}>
            {ratio => (
              <line
                x1={0}
                x2={WIDTH}
                y1={HEIGHT * ratio}
                y2={HEIGHT * ratio}
                stroke="currentColor"
                stroke-opacity="0.08"
                stroke-width="1"
                class="text-foreground"
              />
            )}
          </For>

          <For each={props.series}>
            {(day, dayIndex) => (
              <g
                onMouseEnter={() => setHovered(dayIndex())}
                onMouseLeave={() => setHovered(null)}
              >
                {/* 透明底：鼠标落在柱子以外的空白处也算命中这一天 */}
                <rect
                  x={dayIndex() * columnWidth()}
                  y={0}
                  width={columnWidth()}
                  height={HEIGHT}
                  fill="transparent"
                />
                <Show when={hovered() === dayIndex()}>
                  <rect
                    x={dayIndex() * columnWidth() + 2}
                    y={0}
                    width={columnWidth() - 4}
                    height={HEIGHT}
                    class="fill-foreground/[0.04]"
                  />
                </Show>
                <For each={segments(dayIndex())}>
                  {(segment, index) => (
                    <rect
                      x={dayIndex() * columnWidth() + GAP / 2}
                      y={segment.y}
                      width={columnWidth() - GAP}
                      height={Math.max(segment.height, segment.value > 0 ? 1.5 : 0)}
                      rx={index() === models().length - 1 ? 2 : 0}
                      fill={modelColor(index())}
                      opacity={
                        hovered() === null || hovered() === dayIndex() ? 1 : 0.45
                      }
                    />
                  )}
                </For>
              </g>
            )}
          </For>
        </svg>

        {/* 悬浮明细：按天定位，浮在柱子上方 */}
        <Show when={hovered() !== null}>
          <div
            class="pointer-events-none absolute -top-1 z-10 min-w-40 -translate-x-1/2 -translate-y-full rounded-md border bg-card px-3 py-2 text-xs shadow-md"
            style={{ left: `${((hovered()! + 0.5) / props.series.length) * 100}%` }}
          >
            <p class="mb-1 font-medium">{props.series[hovered()!].date}</p>
            <For each={models()}>
              {model => (
                <Show when={valueOf(props.series[hovered()!], model) > 0}>
                  <p class="flex items-center gap-1.5 py-0.5">
                    <span
                      class="size-2 shrink-0 rounded-full"
                      style={{ background: modelColor(models().indexOf(model)) }}
                      aria-hidden="true"
                    />
                    <span class="truncate">{model}</span>
                    <span class="ml-auto pl-3 font-medium tabular-nums">
                      {props.metric === "tokens" ? (
                        `${formatNumber(valueOf(props.series[hovered()!], model))} tok`
                      ) : (
                        <>
                          <DecimalSplit text={formatPoints(valueOf(props.series[hovered()!], model))} /> 积分
                        </>
                      )}
                    </span>
                  </p>
                </Show>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* 横轴：日期放在 SVG 外面，免得跟着柱宽一起被拉伸变形 */}
      <div class="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <For each={props.series}>{day => <span class="tabular-nums">{day.date.slice(5)}</span>}</For>
      </div>

      {/* 图例：图上不标名字，颜色到这里对号 */}
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <For each={models()}>
          {model => (
            <span class="flex items-center gap-1.5">
              <span
                class="size-2.5 shrink-0 rounded-[3px]"
                style={{ background: modelColor(models().indexOf(model)) }}
                aria-hidden="true"
              />
              {model}
            </span>
          )}
        </For>
      </div>

      <p class="mt-3 text-xs text-muted-foreground">
        峰值
        {props.metric === "tokens" ? (
          <> {formatTokens(peak())} tok</>
        ) : (
          <>
            {" "}
            <DecimalSplit text={formatPoints(peak())} /> 积分
          </>
        )}
      </p>
    </Show>
  );
}
