import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  FileDown,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sun,
  Trash2,
  Users,
  Wand2,
  X
} from "lucide-react";
import {
  Button,
  Chip,
  Drawer,
  Input,
  ListBox,
  Modal,
  Select,
  Spinner,
  Surface,
  Switch,
  Table,
  ToastProvider,
  Tooltip,
  toast,
  useOverlayState
} from "@heroui/react";
import { apiFetch, readToken, type ConfigField, type ConfigSchema, type EditableJob, type WebTask } from "./api";

type ViewKey = "post-download" | "artist-sync" | "config" | "activity";
type ThemeMode = "light" | "dark";

const navItems: Array<{ key: ViewKey; path: string; label: string; icon: ReactNode }> = [
  { key: "post-download", path: "/post-download", label: "帖子下载", icon: <FileDown size={18} /> },
  { key: "artist-sync", path: "/artist-sync", label: "作者同步", icon: <Users size={18} /> },
  { key: "config", path: "/config", label: "环境配置", icon: <Settings size={18} /> },
  { key: "activity", path: "/activity", label: "运行日志", icon: <Activity size={18} /> }
];

function viewFromPath(pathname: string): ViewKey {
  const match = navItems.find((item) => item.path === pathname);
  if (match) return match.key;
  return "post-download";
}

function pathForView(view: ViewKey) {
  return navItems.find((item) => item.key === view)?.path || "/post-download";
}

function urlForView(view: ViewKey) {
  const nextUrl = new URL(window.location.href);
  nextUrl.pathname = pathForView(view);
  return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
}

const defaultPostForm = {
  kind: "post_download",
  title: "",
  url: "",
  service: "",
  creator_id: "",
  post_id: "",
  revision_id: "",
  path: ".",
  dump_post_data: true
};

const defaultCreatorForm = {
  kind: "creator_sync",
  title: "",
  url: "",
  service: "",
  creator_id: "",
  path: ".",
  offset: "0",
  length: "10",
  start_time: "",
  end_time: "",
  keywords: "",
  keywords_exclude: "",
  save_creator_indices: false,
  mix_posts: false
};

const taskParamLabels: Record<string, string> = {
  url: "页面链接",
  service: "服务平台",
  creator_id: "创作者编号",
  post_id: "帖子编号",
  revision_id: "修订编号",
  path: "保存路径",
  offset: "起始偏移",
  length: "同步数量",
  start_time: "开始日期",
  end_time: "结束日期",
  keywords: "包含关键词",
  keywords_exclude: "排除关键词"
};

const configGroupLabels: Record<string, string> = {
  api: "接口",
  downloader: "下载器",
  job: "任务",
  logger: "日志",
  general: "通用"
};

const configNameLabels: Record<string, string> = {
  scheme: "协议",
  netloc: "主机地址",
  statics_netloc: "静态文件主机",
  files_netloc: "帖子文件主机",
  path: "路径",
  timeout: "超时时间",
  retry_times: "重试次数",
  retry_interval: "重试间隔",
  session_key: "会话密钥",
  encoding: "字符集",
  buffer_size: "缓冲区大小",
  chunk_size: "分块大小",
  temp_suffix: "临时后缀",
  retry_stop_never: "永不停止重试",
  tps_limit: "每秒连接数",
  use_bucket: "启用存储桶",
  bucket_path: "存储桶路径",
  reverse_proxy: "反向代理",
  keep_metadata: "保留文件元数据",
  count: "并发数量",
  include_revisions: "包含修订",
  post_dirname_format: "帖子目录格式",
  attachments: "附件目录",
  content: "内容文件",
  external_links: "外部链接文件",
  file: "帖子文件名格式",
  revisions: "修订目录",
  mix_posts: "合并帖子",
  sequential_filename: "附件顺序命名",
  sequential_filename_excludes: "顺序命名排除项",
  filename_format: "文件名格式",
  allow_list: "允许列表",
  block_list: "排除列表",
  extract_content: "提取帖子内容",
  extract_content_images: "提取内容图片",
  extract_external_links: "提取外部链接",
  external_link_patterns: "外部链接匹配规则",
  group_by_year: "按年分组",
  group_by_month: "按月分组",
  year_dirname_format: "年份目录格式",
  month_dirname_format: "月份目录格式",
  keywords: "包含关键词",
  keywords_exclude: "排除关键词",
  download_file: "下载帖子文件",
  download_attachments: "下载附件",
  min_file_size: "最小文件大小",
  max_file_size: "最大文件大小",
  level: "日志级别",
  rotation: "日志轮换",
  ssl_verify: "SSL 证书验证",
  json_dump_indent: "JSON 缩进",
  use_uvloop: "启用事件循环优化"
};

const configTypeLabels: Record<string, string> = {
  choice: "选项",
  str: "文本",
  int: "整数",
  float: "小数",
  bool: "开关",
  Path: "路径",
  array: "列表",
  "optional[int]": "可选整数",
  "optional[float]": "可选小数",
  "optional[Path]": "可选路径",
  "Union[str, int]": "文本或整数",
  "Union[str, int, datetime.time, datetime.timedelta]": "轮换周期"
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function humanizeIdentifier(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function taskParamLabel(kind: WebTask["kind"], key: string) {
  if (kind === "creator_sync" && key === "creator_id") return "作者编号";
  if (kind === "post_download" && key === "url") return "帖子页面链接";
  if (kind === "creator_sync" && key === "url") return "作者页面链接";
  return taskParamLabels[key] || humanizeIdentifier(key);
}

function configGroupLabel(group: string) {
  return configGroupLabels[group] || humanizeIdentifier(group);
}

function configFieldLabel(field: ConfigField) {
  const name = configNameLabels[field.name] || humanizeIdentifier(field.name);
  const group = configGroupLabel(field.group);
  return group === "通用" ? name : `${group} · ${name}`;
}

function configTypeLabel(type: string) {
  return configTypeLabels[type] || humanizeIdentifier(type);
}

function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field-label">
      <span>{props.label}</span>
      {props.children}
      {props.hint ? <span className="field-description">{props.hint}</span> : null}
    </label>
  );
}

function IconButton(props: { label: string; icon: ReactNode; onPress: () => void; variant?: React.ComponentProps<typeof Button>["variant"]; isDisabled?: boolean }) {
  return (
    <Tooltip>
      <Button isIconOnly aria-label={props.label} variant={props.variant || "outline"} isDisabled={props.isDisabled} onPress={props.onPress}>
        {props.icon}
      </Button>
      <Tooltip.Content>{props.label}</Tooltip.Content>
    </Tooltip>
  );
}

function AppSelect(props: {
  value: string;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const selected = props.options.find((item) => item.value === props.value);
  return (
    <Select className="select" selectedKey={props.value} aria-label={props.ariaLabel} onSelectionChange={(key) => props.onChange(String(key))} variant="secondary">
      <Select.Trigger>
        <Select.Value>{selected?.label || props.ariaLabel}</Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox aria-label={props.ariaLabel}>
          {props.options.map((option) => (
            <ListBox.Item id={option.value} key={option.value} textValue={option.label}>
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function StatusChip({ status }: { status: WebTask["status"] }) {
  const tone = status === "completed" ? "success" : status === "running" ? "accent" : status === "failed" ? "danger" : status === "cancelled" ? "warning" : "default";
  const label = {
    queued: "排队中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    paused: "已暂停"
  }[status];
  return (
    <Chip color={tone} size="sm" variant="soft">
      {label}
    </Chip>
  );
}

function KindChip({ kind }: { kind: WebTask["kind"] }) {
  return (
    <Chip size="sm" variant="soft" color={kind === "post_download" ? "accent" : "success"}>
      {kind === "post_download" ? "帖子下载" : "作者同步"}
    </Chip>
  );
}

function ProgressLine({ task }: { task: WebTask }) {
  const percent = task.total ? Math.round((task.completed / task.total) * 100) : 0;
  return (
    <div className="grid min-w-[8rem] gap-1">
      <div className="flex items-center justify-between gap-2 text-xs text-[var(--app-muted)]">
        <span>{task.completed}/{task.total}</span>
        <span>{percent}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }} />
      </div>
    </div>
  );
}

function AppModal(props: { open: boolean; title: string; onOpenChange: (open: boolean) => void; children: ReactNode; footer?: ReactNode }) {
  const state = useOverlayState({ isOpen: props.open, onOpenChange: props.onOpenChange });
  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container size="lg" placement="center" scroll="inside" className="mx-3">
          <Modal.Dialog>
            <Modal.Header className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] px-5 py-4">
              <Modal.Heading className="text-lg font-semibold text-[var(--app-text)]">{props.title}</Modal.Heading>
              <Modal.CloseTrigger className="grid h-9 w-9 place-items-center rounded-lg text-[var(--app-muted)] hover:bg-[var(--app-panel-muted)]" aria-label="关闭">
                <X size={18} />
              </Modal.CloseTrigger>
            </Modal.Header>
            <Modal.Body className="modal-body-scroll p-0">
              <Surface variant="secondary" className="grid gap-4 p-5">
                {props.children}
              </Surface>
            </Modal.Body>
            {props.footer ? <Modal.Footer className="flex justify-end gap-2 border-t border-[var(--app-border)] px-5 py-4">{props.footer}</Modal.Footer> : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function NavContent(props: { view: ViewKey; onView: (view: ViewKey) => void }) {
  return (
    <nav className="grid gap-2">
      {navItems.map((item) => (
        <Button key={item.key} variant="ghost" className="nav-button" data-active={props.view === item.key} data-path={item.path} onPress={() => props.onView(item.key)}>
          {item.icon}
          {item.label}
        </Button>
      ))}
    </nav>
  );
}

function valueForInput(field: ConfigField) {
  if (Array.isArray(field.value)) return field.value.join("\n");
  if (field.value === null || field.value === undefined) return "";
  return field.value;
}

function coerceConfigValue(field: ConfigField, value: unknown) {
  const type = field.type;
  if ((value === "" || value === null) && (type.startsWith("optional[") || field.value === null)) return null;
  if (type === "bool") return Boolean(value);
  if (type === "int" || type === "optional[int]") return value === "" || value === null ? null : Number.parseInt(String(value), 10);
  if (type === "float" || type === "optional[float]") return value === "" || value === null ? null : Number.parseFloat(String(value));
  if (type === "array") {
    if (Array.isArray(value)) return value;
    return String(value)
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value === undefined || value === null ? "" : value;
}

function ConfigPanel(props: {
  schema: ConfigSchema | null;
  values: Record<string, unknown>;
  setValues: (values: Record<string, unknown>) => void;
  onSave: () => void;
  isLoading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const groups = useMemo(() => Array.from(new Set((props.schema?.fields || []).map((field) => field.group))), [props.schema]);
  const fields = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (props.schema?.fields || []).filter((field) => {
      if (group !== "all" && field.group !== group) return false;
      if (!q) return true;
      return `${configFieldLabel(field)} ${configGroupLabel(field.group)} ${field.path} ${field.env} ${field.description}`.toLowerCase().includes(q);
    });
  }, [props.schema, group, query]);
  const dirtyCount = useMemo(() => {
    if (!props.schema) return 0;
    return props.schema.fields.filter((field) => JSON.stringify(coerceConfigValue(field, props.values[field.path])) !== JSON.stringify(field.value)).length;
  }, [props.schema, props.values]);

  return (
    <div className="grid gap-4">
      <Surface variant="secondary" className="toolbar-surface grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <Field label="搜索配置" hint={props.schema ? `写入目标：${props.schema.envPath}` : undefined}>
          <Input className="textfield" variant="secondary" value={query} placeholder="配置名称、环境变量或说明" onChange={(event) => setQuery(event.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Chip variant={group === "all" ? "primary" : "soft"} color="accent" className="cursor-pointer" onClick={() => setGroup("all")}>
            全部
          </Chip>
          {groups.map((name) => (
            <Chip key={name} variant={group === name ? "primary" : "soft"} className="cursor-pointer" onClick={() => setGroup(name)}>
              {configGroupLabel(name)}
            </Chip>
          ))}
          <Button variant="primary" isPending={props.isLoading} isDisabled={!dirtyCount || props.isLoading} onPress={props.onSave}>
            <Save size={16} />
            保存 {dirtyCount ? `(${dirtyCount})` : ""}
          </Button>
        </div>
      </Surface>

      <div className="config-grid">
        {fields.map((field) => (
          <div className="config-item" key={field.path}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="break-words text-sm font-semibold text-[var(--app-text)]">{configFieldLabel(field)}</div>
                <div className="field-description break-all">技术键：{field.path} · 环境变量：{field.env}</div>
              </div>
              <Chip size="sm" variant="soft">{configTypeLabel(field.type)}</Chip>
            </div>
            {renderConfigControl(field, props.values[field.path], (value) => props.setValues({ ...props.values, [field.path]: value }))}
            {field.description ? <p className="field-description m-0">{field.description}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderConfigControl(field: ConfigField, value: unknown, onChange: (value: unknown) => void) {
  if (field.type === "bool") {
    return (
      <Switch.Root isSelected={Boolean(value)} onChange={onChange}>
        <Switch.Content className="inline-flex min-h-10 items-center gap-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-panel-muted)] px-3 text-sm font-semibold">
          <span className={`h-5 w-9 rounded-full p-0.5 transition ${value ? "bg-[var(--app-accent)]" : "bg-[var(--app-border)]"}`}>
            <span className={`block h-4 w-4 rounded-full bg-white transition ${value ? "translate-x-4" : ""}`} />
          </span>
          {value ? "启用" : "停用"}
        </Switch.Content>
      </Switch.Root>
    );
  }
  if (field.choices?.length) {
    return <AppSelect value={String(value || "")} ariaLabel={configFieldLabel(field)} options={field.choices.map((choice) => ({ value: String(choice), label: String(choice) }))} onChange={onChange} />;
  }
  if (field.type === "array") {
    return (
      <textarea
        className="min-h-24 w-full resize-y rounded-lg border border-[var(--field-border)] bg-[var(--field-background)] p-3 text-sm text-[var(--field-foreground)] outline-none focus:border-[var(--field-border-focus)]"
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <Input
      className="textfield"
      variant="secondary"
      type={field.type.includes("int") || field.type.includes("float") ? "number" : "text"}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function TaskCreatePanel(props: { kind: WebTask["kind"]; onCreate: (kind: WebTask["kind"], params: Record<string, unknown>, title?: string) => void; isLoading: boolean }) {
  const [postForm, setPostForm] = useState(defaultPostForm);
  const [creatorForm, setCreatorForm] = useState(defaultCreatorForm);
  const isPost = props.kind === "post_download";
  const form = isPost ? postForm : creatorForm;
  const setField = (key: string, value: unknown) => {
    if (isPost) setPostForm({ ...postForm, [key]: value });
    else setCreatorForm({ ...creatorForm, [key]: value });
  };

  const submit = () => {
    const params = { ...form };
    delete (params as Record<string, unknown>).kind;
    const title = String((params as Record<string, unknown>).title || "");
    delete (params as Record<string, unknown>).title;
    props.onCreate(props.kind, params, title || undefined);
  };

  return (
    <Surface variant="secondary" className="toolbar-surface grid gap-3 p-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <Field label="任务名称">
          <Input className="textfield" variant="secondary" value={String(form.title)} placeholder="可选，留空自动生成" onChange={(event) => setField("title", event.target.value)} />
        </Field>
        <Chip color={isPost ? "accent" : "success"} variant="soft">
          {isPost ? "帖子下载" : "作者同步"}
        </Chip>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label={isPost ? "帖子页面链接" : "作者页面链接"}>
          <Input className="textfield" variant="secondary" value={String(form.url)} placeholder="粘贴 Kemono / Coomer 页面链接" onChange={(event) => setField("url", event.target.value)} />
        </Field>
        <Field label="服务平台">
          <Input className="textfield" variant="secondary" value={String(form.service)} placeholder="fanbox / patreon" onChange={(event) => setField("service", event.target.value)} />
        </Field>
        <Field label={isPost ? "创作者编号" : "作者编号"}>
          <Input className="textfield" variant="secondary" value={String(form.creator_id)} onChange={(event) => setField("creator_id", event.target.value)} />
        </Field>
        {isPost ? (
          <Field label="帖子编号">
            <Input className="textfield" variant="secondary" value={String(postForm.post_id)} onChange={(event) => setField("post_id", event.target.value)} />
          </Field>
        ) : (
          <Field label="数量">
            <Input className="textfield" variant="secondary" type="number" value={String(creatorForm.length)} onChange={(event) => setField("length", event.target.value)} />
          </Field>
        )}
        <Field label="保存路径">
          <Input className="textfield" variant="secondary" value={String(form.path)} onChange={(event) => setField("path", event.target.value)} />
        </Field>
        {isPost ? (
          <Field label="修订编号">
            <Input className="textfield" variant="secondary" value={String(postForm.revision_id)} onChange={(event) => setField("revision_id", event.target.value)} />
          </Field>
        ) : (
          <>
            <Field label="起始偏移">
              <Input className="textfield" variant="secondary" type="number" value={String(creatorForm.offset)} onChange={(event) => setField("offset", event.target.value)} />
            </Field>
            <Field label="开始日期">
              <Input className="textfield" variant="secondary" type="date" value={String(creatorForm.start_time)} onChange={(event) => setField("start_time", event.target.value)} />
            </Field>
            <Field label="结束日期">
              <Input className="textfield" variant="secondary" type="date" value={String(creatorForm.end_time)} onChange={(event) => setField("end_time", event.target.value)} />
            </Field>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {isPost ? (
            <Switch.Root isSelected={Boolean(postForm.dump_post_data)} onChange={(value) => setField("dump_post_data", value)}>
              <Switch.Content className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--app-border)] px-3 text-sm font-semibold">
                <FileDown size={16} />
                写入 post.json
              </Switch.Content>
            </Switch.Root>
          ) : (
            <>
              <Field label="包含关键词">
                <Input className="w-56" variant="secondary" value={String(creatorForm.keywords)} placeholder="逗号分隔" onChange={(event) => setField("keywords", event.target.value)} />
              </Field>
              <Field label="排除关键词">
                <Input className="w-56" variant="secondary" value={String(creatorForm.keywords_exclude)} placeholder="逗号分隔" onChange={(event) => setField("keywords_exclude", event.target.value)} />
              </Field>
              <Switch.Root isSelected={Boolean(creatorForm.save_creator_indices)} onChange={(value) => setField("save_creator_indices", value)}>
                <Switch.Content className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--app-border)] px-3 text-sm font-semibold">
                  <Users size={16} />
                  保存索引
                </Switch.Content>
              </Switch.Root>
              <Switch.Root isSelected={Boolean(creatorForm.mix_posts)} onChange={(value) => setField("mix_posts", value)}>
                <Switch.Content className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--app-border)] px-3 text-sm font-semibold">
                  <FileDown size={16} />
                  混合帖子
                </Switch.Content>
              </Switch.Root>
            </>
          )}
        </div>
        <Button variant="primary" isPending={props.isLoading} onPress={submit}>
          <Plus size={16} />
          {isPost ? "创建帖子下载" : "创建作者同步"}
        </Button>
      </div>
    </Surface>
  );
}

function TaskTable(props: {
  tasks: WebTask[];
  label: string;
  onEdit: (task: WebTask) => void;
  onMaterialize: (task: WebTask) => void;
  onStart: (task: WebTask) => void;
  onCancel: (task: WebTask) => void;
  onDuplicate: (task: WebTask) => void;
  onDelete: (task: WebTask) => void;
}) {
  if (!props.tasks.length) {
    return (
      <div className="surface-frame grid min-h-56 place-items-center p-8 text-center">
        <div>
          <Download className="mx-auto mb-3 text-[var(--app-accent)]" size={34} />
          <div className="text-base font-semibold">暂无 {props.label} 任务</div>
          <p className="m-0 mt-1 text-sm text-[var(--app-muted)]">创建任务后，会在这里进行编辑和管理。</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Table className="hidden md:block">
        <Table.ScrollContainer className="table__wrapper">
          <Table.Content aria-label={`${props.label}任务`}>
            <Table.Header>
              <Table.Column>任务</Table.Column>
              <Table.Column>类型</Table.Column>
              <Table.Column>状态</Table.Column>
              <Table.Column>进度</Table.Column>
              <Table.Column>更新时间</Table.Column>
              <Table.Column>操作</Table.Column>
            </Table.Header>
            <Table.Body>
              {props.tasks.map((task) => (
                <Table.Row id={task.id} key={task.id}>
                  <Table.Cell>
                    <div className="max-w-[22rem]">
                      <div className="truncate font-semibold text-[var(--app-text)]">{task.title}</div>
                      <div className="truncate text-xs text-[var(--app-muted)]">{String(task.params.url || task.params.path || task.id)}</div>
                    </div>
                  </Table.Cell>
                  <Table.Cell><KindChip kind={task.kind} /></Table.Cell>
                  <Table.Cell><StatusChip status={task.status} /></Table.Cell>
                  <Table.Cell><ProgressLine task={task} /></Table.Cell>
                  <Table.Cell><span className="text-sm text-[var(--app-muted)]">{task.updated_at}</span></Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-1">
                      <IconButton label="生成文件任务" icon={<Wand2 size={16} />} onPress={() => props.onMaterialize(task)} isDisabled={task.status === "running"} />
                      <IconButton label="开始" icon={<Download size={16} />} onPress={() => props.onStart(task)} isDisabled={task.status === "running"} />
                      <IconButton label="编辑" icon={<Edit3 size={16} />} onPress={() => props.onEdit(task)} isDisabled={task.status === "running"} />
                      <IconButton label="复制" icon={<Copy size={16} />} onPress={() => props.onDuplicate(task)} />
                      <IconButton label="取消" icon={<X size={16} />} onPress={() => props.onCancel(task)} isDisabled={task.status !== "running"} />
                      <IconButton label="删除" icon={<Trash2 size={16} />} variant="danger" onPress={() => props.onDelete(task)} />
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      <div className="grid gap-3 md:hidden">
        {props.tasks.map((task) => (
          <article className="task-card" key={task.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold">{task.title}</div>
                <div className="mt-1 flex flex-wrap gap-1"><KindChip kind={task.kind} /><StatusChip status={task.status} /></div>
              </div>
              <IconButton label="编辑" icon={<Edit3 size={16} />} onPress={() => props.onEdit(task)} />
            </div>
            <ProgressLine task={task} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onPress={() => props.onMaterialize(task)}><Wand2 size={14} />生成</Button>
              <Button size="sm" variant="primary" onPress={() => props.onStart(task)}><Download size={14} />开始</Button>
              <Button size="sm" variant="danger" onPress={() => props.onDelete(task)}><Trash2 size={14} />删除</Button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function TaskPage(props: {
  kind: WebTask["kind"];
  label: string;
  icon: ReactNode;
  tasks: WebTask[];
  isLoading: boolean;
  onCreate: (kind: WebTask["kind"], params: Record<string, unknown>, title?: string) => void;
  onEdit: (task: WebTask) => void;
  onMaterialize: (task: WebTask) => void;
  onStart: (task: WebTask) => void;
  onCancel: (task: WebTask) => void;
  onDuplicate: (task: WebTask) => void;
  onDelete: (task: WebTask) => void;
}) {
  const scopedTasks = props.tasks.filter((task) => task.kind === props.kind);
  const runningCount = scopedTasks.filter((task) => task.status === "running").length;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--app-accent-soft)] text-[var(--app-accent)]">
            {props.icon}
          </div>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-xl font-bold text-[var(--app-text)]">{props.label}</h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip variant="soft" color="default">{scopedTasks.length} 个任务</Chip>
          <Chip variant="soft" color={runningCount ? "accent" : "default"}>{runningCount} 运行中</Chip>
        </div>
      </div>
      <TaskCreatePanel kind={props.kind} onCreate={props.onCreate} isLoading={props.isLoading} />
      <TaskTable
        label={props.label}
        tasks={scopedTasks}
        onEdit={props.onEdit}
        onMaterialize={props.onMaterialize}
        onStart={props.onStart}
        onCancel={props.onCancel}
        onDuplicate={props.onDuplicate}
        onDelete={props.onDelete}
      />
    </div>
  );
}

function TaskEditor(props: { task: WebTask | null; onClose: () => void; onSave: (task: WebTask) => void }) {
  const [draft, setDraft] = useState<WebTask | null>(props.task);
  useEffect(() => setDraft(props.task ? structuredClone(props.task) : null), [props.task]);
  if (!draft) return null;

  const setParam = (key: string, value: unknown) => setDraft({ ...draft, params: { ...draft.params, [key]: value } });
  const setJob = (index: number, job: EditableJob) => {
    const jobs = [...draft.jobs];
    jobs[index] = job;
    setDraft({ ...draft, jobs });
  };
  const addJob = () =>
    setDraft({
      ...draft,
      jobs: [
        ...draft.jobs,
        {
          id: crypto.randomUUID(),
          enabled: true,
          path: ".",
          server_path: "/data/file",
          alt_filename: "",
          status: "waiting"
        }
      ]
    });

  const params = draft.kind === "post_download"
    ? ["url", "service", "creator_id", "post_id", "revision_id", "path"]
    : ["url", "service", "creator_id", "path", "offset", "length", "start_time", "end_time", "keywords", "keywords_exclude"];

  return (
    <AppModal
      open={Boolean(props.task)}
      title="编辑任务"
      onOpenChange={(open) => (!open ? props.onClose() : null)}
      footer={
        <>
          <Button variant="ghost" slot="close">取消</Button>
          <Button variant="primary" onPress={() => props.onSave(draft)}>
            <Save size={16} />
            保存
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="任务名称">
          <Input className="textfield" variant="secondary" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          {params.map((key) => (
            <Field label={taskParamLabel(draft.kind, key)} key={key}>
              <Input className="textfield" variant="secondary" value={String(draft.params[key] ?? "")} onChange={(event) => setParam(key, event.target.value)} />
            </Field>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">文件任务</div>
            <div className="field-description">可启用/停用、改保存路径、改服务端路径或替代文件名。</div>
          </div>
          <Button variant="outline" onPress={addJob}>
            <Plus size={16} />
            添加文件
          </Button>
        </div>
        <div className="grid gap-2">
          {draft.jobs.map((job, index) => (
            <div className="grid gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-panel)] p-3" key={job.id}>
              <div className="flex items-center justify-between gap-2">
                <Switch.Root isSelected={job.enabled} onChange={(enabled) => setJob(index, { ...job, enabled })}>
                  <Switch.Content className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--app-border)] px-3 text-sm font-semibold">
                    <CheckCircle2 size={15} />
                    {job.enabled ? "启用" : "停用"}
                  </Switch.Content>
                </Switch.Root>
                <Button
                  isIconOnly
                  aria-label="删除文件任务"
                  variant="danger"
                  onPress={() => setDraft({ ...draft, jobs: draft.jobs.filter((_, jobIndex) => jobIndex !== index) })}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <Field label="本地保存路径">
                  <Input variant="secondary" value={job.path} aria-label="本地保存路径" onChange={(event) => setJob(index, { ...job, path: event.target.value })} />
                </Field>
                <Field label="服务器文件路径">
                  <Input variant="secondary" value={job.server_path} aria-label="服务器文件路径" onChange={(event) => setJob(index, { ...job, server_path: event.target.value })} />
                </Field>
                <Field label="替代文件名">
                  <Input variant="secondary" value={job.alt_filename || ""} aria-label="替代文件名" onChange={(event) => setJob(index, { ...job, alt_filename: event.target.value })} />
                </Field>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppModal>
  );
}

export function App() {
  const [token] = useState(readToken);
  const [view, setView] = useState<ViewKey>(() => viewFromPath(window.location.pathname));
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [schema, setSchema] = useState<ConfigSchema | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [tasks, setTasks] = useState<WebTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<WebTask | null>(null);
  const mobileNav = useOverlayState({});

  const navigate = (nextView: ViewKey) => {
    if (nextView !== view) {
      window.history.pushState({ view: nextView }, "", urlForView(nextView));
      setView(nextView);
    }
  };

  useEffect(() => {
    const nextView = viewFromPath(window.location.pathname);
    const canonicalPath = pathForView(nextView);
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState({ view: nextView }, "", urlForView(nextView));
    }
    setView(nextView);
    const onPopState = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.colorScheme = theme;
  }, [theme]);

  const load = async (mode: "silent" | "manual" = "silent") => {
    if (!token) return;
    try {
      setLoading(true);
      const [nextSchema, nextTasks] = await Promise.all([
        apiFetch<ConfigSchema>("/api/config", token),
        apiFetch<WebTask[]>("/api/tasks", token)
      ]);
      setSchema(nextSchema);
      setConfigValues(Object.fromEntries(nextSchema.fields.map((field) => [field.path, valueForInput(field)])));
      setTasks(nextTasks);
      if (mode === "manual") toast.success("已刷新");
    } catch (error) {
      toast.danger("刷新失败", { description: errorText(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    if (!tasks.some((task) => task.status === "running")) return;
    const timer = window.setInterval(() => load("silent"), 1500);
    return () => window.clearInterval(timer);
  }, [tasks, token]);

  const saveConfig = async () => {
    if (!schema) return;
    try {
      setLoading(true);
      const values = Object.fromEntries(schema.fields.map((field) => [field.path, coerceConfigValue(field, configValues[field.path])]));
      const nextSchema = await apiFetch<ConfigSchema>("/api/config", token, { method: "PUT", body: JSON.stringify({ values, language: "zh" }) });
      setSchema(nextSchema);
      setConfigValues(Object.fromEntries(nextSchema.fields.map((field) => [field.path, valueForInput(field)])));
      toast.success("配置已保存", { description: nextSchema.envPath });
    } catch (error) {
      toast.danger("配置保存失败", { description: errorText(error) });
    } finally {
      setLoading(false);
    }
  };

  const taskAction = async (label: string, action: () => Promise<unknown>) => {
    try {
      setLoading(true);
      await action();
      await load("silent");
      toast.success(label);
    } catch (error) {
      toast.danger(`${label}失败`, { description: errorText(error) });
    } finally {
      setLoading(false);
    }
  };

  const createTask = (kind: WebTask["kind"], params: Record<string, unknown>, title?: string) =>
    taskAction("任务已创建", () => apiFetch("/api/tasks", token, { method: "POST", body: JSON.stringify({ kind, params, title }) }));

  const saveTask = (task: WebTask) =>
    taskAction("任务已保存", () =>
      apiFetch(`/api/tasks/${task.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ title: task.title, params: task.params, jobs: task.jobs })
      })
    ).then(() => setEditing(null));

  if (!token) {
    return (
      <main className="app-shell">
        <div className="grid min-h-[100dvh] place-items-center p-6">
          <div className="surface-frame max-w-md p-6 text-center">
            <Settings className="mx-auto mb-3 text-[var(--app-accent)]" size={36} />
            <h1 className="m-0 text-xl font-bold">需要访问 Token</h1>
            <p className="text-sm text-[var(--app-muted)]">请使用 `ktoolbox webui` 输出的带 token 链接打开面板。</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header px-4 py-3">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Button className="md:hidden" isIconOnly aria-label="打开菜单" variant="outline" onPress={mobileNav.open}>
              <Menu size={18} />
            </Button>
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--app-accent-soft)] text-[var(--app-accent)]">
              <Download size={21} />
            </div>
            <div className="header-copy min-w-0">
              <div className="truncate text-base font-bold">KToolBox WebUI</div>
              <div className="header-subtitle truncate text-xs text-[var(--app-muted)]">帖子下载、作者同步与环境配置</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="header-status-chip">
              <Chip variant="soft" color={tasks.some((task) => task.status === "running") ? "accent" : "default"}>
                {tasks.filter((task) => task.status === "running").length} 运行中
              </Chip>
            </span>
            <IconButton label="刷新" icon={loading ? <Spinner size="sm" /> : <RefreshCw size={16} />} onPress={() => load("manual")} />
            <IconButton label="切换主题" icon={theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} onPress={() => setTheme(theme === "dark" ? "light" : "dark")} />
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar p-4">
          <NavContent view={view} onView={navigate} />
        </aside>
        <main className="main-scroll">
          <div className="mx-auto grid max-w-[1600px] gap-4 p-4">
            {view === "post-download" ? (
              <TaskPage
                kind="post_download"
                label="帖子下载"
                icon={<FileDown size={20} />}
                tasks={tasks}
                isLoading={loading}
                onCreate={createTask}
                onEdit={setEditing}
                onMaterialize={(task) => taskAction("文件任务已生成", () => apiFetch(`/api/tasks/${task.id}/materialize`, token, { method: "POST" }))}
                onStart={(task) => taskAction("任务已开始", () => apiFetch(`/api/tasks/${task.id}/start`, token, { method: "POST" }))}
                onCancel={(task) => taskAction("任务已取消", () => apiFetch(`/api/tasks/${task.id}/cancel`, token, { method: "POST" }))}
                onDuplicate={(task) => taskAction("任务已复制", () => apiFetch(`/api/tasks/${task.id}/duplicate`, token, { method: "POST" }))}
                onDelete={(task) => taskAction("任务已删除", () => apiFetch(`/api/tasks/${task.id}`, token, { method: "DELETE" }))}
              />
            ) : null}
            {view === "artist-sync" ? (
              <TaskPage
                kind="creator_sync"
                label="作者同步"
                icon={<Users size={20} />}
                tasks={tasks}
                isLoading={loading}
                onCreate={createTask}
                onEdit={setEditing}
                onMaterialize={(task) => taskAction("文件任务已生成", () => apiFetch(`/api/tasks/${task.id}/materialize`, token, { method: "POST" }))}
                onStart={(task) => taskAction("任务已开始", () => apiFetch(`/api/tasks/${task.id}/start`, token, { method: "POST" }))}
                onCancel={(task) => taskAction("任务已取消", () => apiFetch(`/api/tasks/${task.id}/cancel`, token, { method: "POST" }))}
                onDuplicate={(task) => taskAction("任务已复制", () => apiFetch(`/api/tasks/${task.id}/duplicate`, token, { method: "POST" }))}
                onDelete={(task) => taskAction("任务已删除", () => apiFetch(`/api/tasks/${task.id}`, token, { method: "DELETE" }))}
              />
            ) : null}
            {view === "config" ? <ConfigPanel schema={schema} values={configValues} setValues={setConfigValues} onSave={saveConfig} isLoading={loading} /> : null}
            {view === "activity" ? (
              <div className="grid gap-3">
                {tasks.flatMap((task) => task.logs.map((line, index) => ({ task, line, index }))).map(({ task, line, index }) => (
                  <div className="task-card" key={`${task.id}-${index}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <KindChip kind={task.kind} />
                      <StatusChip status={task.status} />
                      <span className="font-semibold">{task.title}</span>
                    </div>
                    <div className="text-sm text-[var(--app-muted)]">{line}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </main>
      </div>

      <Drawer state={mobileNav}>
        <Drawer.Backdrop variant="blur">
          <Drawer.Content placement="left">
            <Drawer.Dialog className="p-0">
              <Drawer.Header className="border-b border-[var(--app-border)] px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <Drawer.Heading className="text-base font-semibold">菜单</Drawer.Heading>
                  <Drawer.CloseTrigger className="grid h-9 w-9 place-items-center rounded-lg text-[var(--app-muted)] hover:bg-[var(--app-panel-muted)]" aria-label="关闭菜单">
                    <X size={18} />
                  </Drawer.CloseTrigger>
                </div>
              </Drawer.Header>
              <Drawer.Body className="p-4">
                <NavContent
                  view={view}
                  onView={(nextView) => {
                    navigate(nextView);
                    mobileNav.close();
                  }}
                />
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      <TaskEditor task={editing} onClose={() => setEditing(null)} onSave={saveTask} />
      <ToastProvider placement="top" width={360} />
    </div>
  );
}
