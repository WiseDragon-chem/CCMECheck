/**
 * 面向用户的全部文案。
 *
 * 这是单一语言产品，**不引入 i18n 库** —— 集中在这里的理由不是国际化，
 * 而是让文案能被单独审阅：组织者想核对「用户到底看到哪些字」时，
 * 只看这一个文件就够了，不必翻十几个组件。
 *
 * 术语沿用 design.md 的原词，不要另造同义词：
 *   打卡（非签到）、赛道（非分类）、驳回（非拒绝）、审核（非审查）、
 *   证明材料（非附件）、激活码（非邀请码）。
 * 组织者在微信群推文里用的就是这套词，界面必须与之一致。
 */
export const zh = {
  app: {
    name: '国庆打卡',
    subtitle: '化学与分子工程学院',
  },

  nav: {
    /** 底部导航整体的无障碍名称，读屏用户会先听到它 */
    label: '主导航',
    home: '首页',
    records: '记录',
    leaderboard: '排行榜',
    me: '我的',
  },

  dateTime: {
    /** 0 = 周日。索引与 Date.getDay() 对齐 */
    weekdays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const,
    deadlinePassed: '已截止',
    remainingHoursMinutes: (hours: number, minutes: number) => `${hours} 小时 ${minutes} 分`,
    remainingMinutesSeconds: (minutes: number, seconds: number) => `${minutes} 分 ${seconds} 秒`,
    remainingSeconds: (seconds: number) => `${seconds} 秒`,
  },

  upload: {
    networkError: '网络异常，请检查网络后重试',
    timeout: '上传超时，请重试',
    aborted: '已取消上传',
    failed: (status: number) => `上传失败（${status}）`,
    requestFailed: (status: number) => `请求失败（${status}）`,
    sessionExpired: '登录状态已失效',
  },

  common: {
    retry: '重新加载',
    backHome: '回到首页',
    backToRecords: '返回记录列表',
    submit: '提交',
    retrySubmit: '重试提交',
    loadFailed: '请检查网络后重试。',
    trackingId: (id: string) => `追踪号 ${id}`,
  },

  auth: {
    login: {
      title: '登录',
      subtitle: '使用学号与密码登录',
      studentId: '学号',
      studentIdPlaceholder: '请输入学号',
      studentIdRequired: '请填写学号',
      password: '密码',
      passwordPlaceholder: '请输入密码',
      passwordRequired: '请填写密码',
      submit: '登录',
      notActivatedYet: '还没有激活？',
      goActivate: '去激活',
      forgotPassword: '忘记密码请联系活动管理员重置。',
      notActivatedNotice: '该账号尚未激活，请先使用激活码完成激活',
    },
    activate: {
      title: '激活账号',
      subtitle: '使用管理员发放的学号与激活码完成首次激活',
      studentId: '学号',
      studentIdPlaceholder: '请输入学号',
      studentIdRequired: '请填写学号',
      activationCode: '激活码',
      activationCodePlaceholder: '请输入激活码',
      activationCodeRequired: '请填写激活码',
      password: '设置密码',
      passwordPlaceholder: '至少 8 位，含字母与数字',
      passwordRequired: '请设置密码',
      passwordMin: (n: number) => `密码至少 ${n} 位`,
      passwordMax: (n: number) => `密码不能超过 ${n} 位`,
      passwordNeedsLetter: '密码需要包含字母',
      passwordNeedsDigit: '密码需要包含数字',
      confirm: '确认密码',
      confirmPlaceholder: '再次输入密码',
      confirmRequired: '请再次输入密码',
      confirmMismatch: '两次输入的密码不一致',
      submit: '激活并登录',
      alreadyActivated: '已经激活过？',
      goLogin: '去登录',
      nameLockNotice: '激活后学号与姓名不能自行修改，如需更正请联系管理员。',
    },
    profile: {
      title: '我的',
      name: '姓名',
      studentId: '学号',
      nameLockNotice: '学号与姓名如需更正，请联系活动管理员。',
      changePassword: '修改密码',
      currentPassword: '当前密码',
      currentPasswordRequired: '请填写当前密码',
      newPassword: '新密码',
      newPasswordPlaceholder: '至少 8 位，含字母与数字',
      newPasswordRequired: '请设置新密码',
      newPasswordMin: (n: number) => `新密码至少 ${n} 位`,
      newPasswordNeedsLetter: '新密码需要包含字母',
      newPasswordNeedsDigit: '新密码需要包含数字',
      confirmNewPassword: '确认新密码',
      confirmRequired: '请再次输入新密码',
      confirmMismatch: '两次输入的密码不一致',
      savePassword: '保存新密码',
      passwordChanged: '密码已修改，其他设备需要重新登录',
      logout: '退出登录',
      logoutConfirmTitle: '确认退出登录？',
      logoutOk: '退出',
      logoutCancel: '取消',
    },
  },

  checkin: {
    /** §7.3 的九种卡片状态：文字必须两两不同（有单测守着） */
    cardState: {
      before_open: '今日打卡尚未开放',
      can_submit: '今日尚未打卡',
      submit_closed: '活动已停止提交',
      pending: '已提交，等待审核',
      approved: '今日打卡有效',
      rejected_open: '已驳回',
      rejected_closed: '今日打卡无效（已截止）',
      missed: '今日未完成',
      invalid: '记录已失效',
    },
    cardAction: {
      submit: '去打卡',
      resubmit: '重新提交',
      detail: '查看详情',
    },
    /** §6.4 记录的四种结论状态 */
    status: {
      pending: '待审核',
      approved: '已通过',
      rejected: '已驳回',
      revoked: '已撤销',
      void: '已作废',
    },
    home: {
      validDaysSummary: (days: number) => `累计有效 ${days} 天`,
      countdown: (remaining: string) => `距今日截止 ${remaining}`,
      deadlineHint: (time: string) => `今日截止 ${time}`,
      deadlineCountdownHint: (remaining: string) => `距截止 ${remaining}`,
      validDaysAndScore: (days: number, score: string) => `有效 ${days} 天 · 积分 ${score}`,
      rejectionPrefix: (reason: string) => `驳回原因：${reason}`,
      campaignSettling: '活动已进入结算阶段，停止提交打卡',
      campaignFinished: '活动已结束',
      campaignNotOpen: '活动当前未开放打卡',
      campaignStatusDetail: '已有记录的审核结果仍可查看。',
      leaderboardCadence: (time: string) =>
        `排行榜每日 ${time} 更新，今日通过的记录将在下次更新后计入。`,
      notParticipant: '当前账号不是本次活动的参赛者。',
      notParticipantHint: '如需参赛，请联系管理员把你加入参赛名单。',
      loadFailed: '没能加载今日打卡',
    },
    submit: {
      proofRequirement: '有效证明要求',
      materials: '证明材料',
      addImage: '添加图片',
      note: '文字备注',
      notePlaceholder: '可选，补充说明本次打卡的内容',
      minImages: (n: number) => `至少需要 ${n} 张证明材料`,
      uploading: '正在上传证明材料…',
      processing: '服务器正在处理图片…',
      submitted: '已提交，等待审核',
      alreadySubmitted: '这次提交此前已经完成',
      resubmittedNotice: '提交后可在今日截止前重新提交，审核仅以最新一次为准。',
      reopenBanner: (time: string) => `管理员已临时重新开放至 ${time}`,
      reopenDetail: '请在此时间前完成提交。',
      alreadyApprovedTitle: '该记录已审核通过',
      alreadyApprovedDetail: '如需修改，请联系管理员重新打开该记录。',
      invalidTitle: '该记录已失效',
      invalidDetail: '该记录已被管理员处置，无法再次提交。',
      closedTitle: '活动已停止提交',
      missedTitle: '今日打卡已截止',
      closedDetail: '本活动日的打卡不能再提交或修改。',
      trackNotFound: '赛道不存在',
      trackNotFoundDetail: '该赛道不在此活动中，或已停用。',
      loadFailed: '没能加载打卡信息',
      dragToReorder: ' · 拖动缩略图可调整顺序',
      /** 上传规则摘要，由活动配置拼出：1–3 张，JPEG、PNG、WebP，单张不超过 10 MB */
      uploadRules: (min: number, max: number, formats: string, limitMb: number) =>
        `${min}–${max} 张，${formats}，单张不超过 ${limitMb} MB`,
      sizeLimitMb: (limitMb: number) => `${limitMb} MB`,
      tooManyImages: (max: number) => `最多只能上传 ${max} 张图片`,
      ignoredExtra: (room: number) => `最多还能再加 ${room} 张，已忽略多余的图片`,
      notAnImage: (name: string) => `「${name}」不是有效的图片，可能只是改了扩展名`,
      unsupportedFormat: (name: string, mime: string) => `「${name}」是 ${mime}，当前活动不接受该格式`,
      tooLarge: (name: string, size: string, limitMb: number) =>
        `「${name}」${size}，超过单张 ${limitMb} MB 的限制`,
      deleteImage: (index: number) => `删除第 ${index + 1} 张`,
      proofAlt: (index: number) => `证明材料 ${index + 1}`,
    },
    records: {
      title: '打卡记录',
      allTracks: '全部赛道',
      allStatuses: '全部状态',
      submittedAt: (time: string) => `提交于 ${time}`,
      assetCount: (n: number) => `${n} 张`,
      total: (n: number) => `共 ${n} 条记录`,
      loadMore: (shown: number, total: number) => `加载更多（已显示 ${shown} / ${total}）`,
      empty: '还没有打卡记录，去首页完成第一次打卡吧。',
      emptyFiltered: '当前筛选条件下没有记录。',
      clearFilters: '清除筛选',
      loadFailed: '没能加载打卡记录',
      rejectionPrefix: (reason: string) => `驳回原因：${reason}`,
    },
    detail: {
      noAssets: '本条记录没有证明材料。',
      submitInfo: '提交信息',
      submittedAt: '提交时间',
      reviewedAt: '审核时间',
      notReviewed: '尚未审核',
      revision: '版本',
      revisionN: (n: number) => `第 ${n} 版`,
      note: '备注',
      history: (n: number) => `提交历史（${n} 个较早版本）`,
      historyItem: (n: number, count: number) => `第 ${n} 版 · ${count} 张`,
      historyLatestOnly: '审核仅以最新一次提交为准。',
      rejectedTitle: '本条记录被驳回',
      revokedTitle: '审核结果已被管理员撤销',
      revokedDetail: '该记录不再计分。如有疑问请联系活动管理员。',
      voidTitle: '该记录已被作废',
      voidDetail: '如有疑问请联系活动管理员。',
      reopenTitle: '管理员已临时重新开放',
      reopenDetail: (time: string) => `请在此时间前完成重新提交：${time}`,
      loadFailed: '没能加载记录详情',
      loadFailedDetail: '记录可能已被删除，或网络异常。',
      imageLoadFailed: '图片加载失败',
      reloadImage: '重新加载',
      viewLarger: '点击查看大图',
    },
    /** 赛道图标：后端给的是自由字符串，必须带兜底 */
    trackIconFallback: '📌',
  },

  leaderboard: {
    title: '排行榜',
    overall: '总榜',
    cadence: (time: string) => `每日 ${time} 更新，已通过的记录将在下次更新后计入`,
    countedThrough: (date: string, generatedAt: string) => `统计至 ${date} · 生成于 ${generatedAt}`,
    finalBadge: '最终榜单',
    snapshotFailed: '最近一次快照生成失败，当前显示的仍是上一份有效数据。',
    empty: '这个榜单暂时没有数据。',
    notGenerated: '排行榜尚未生成，请等待管理员完成第一次统计。',
    me: '我',
    meMeta: (className: string, days: number) => `${className} · 有效 ${days} 天`,
    loadMore: (shown: number, total: number) => `加载更多（已显示 ${shown} / ${total}）`,
    loadFailed: '没能加载排行榜',
  },

  error: {
    pageTitle: '页面出错了',
    pageSubtitle: '请刷新重试。若持续出现，请把下面的信息发给活动管理员。',
    reload: '刷新页面',
    notFoundTitle: '页面不存在',
    notFoundSubtitle: '链接可能已经失效，或者地址输错了。',
    unknown: '出了点问题，请稍后重试',
  },

  /**
   * 错误码 → 用户可见文案。
   *
   * 只覆盖需要改写服务端措辞的那些；其余直接用服务端返回的 message
   * （它通常更准，含具体上下文）。分支一律依据稳定的 code，
   * 文案只是展示层的事（design.md §12.5）。
   */
  errorCode: {
    TOKEN_INVALID: '登录状态已失效，请重新登录',
    ACCOUNT_DISABLED: '账号已被禁用，请联系管理员',
    ACCOUNT_NOT_ACTIVATED: '账号尚未激活',
    ACTIVATION_INVALID: '学号或激活码不正确，或激活码已失效',
    CHECKIN_CLOSED: '该活动日的打卡已经截止',
    CHECKIN_NOT_OPEN: '今日打卡尚未开放',
    CHECKIN_ALREADY_APPROVED: '该记录已审核通过，如需修改请联系管理员重新打开',
    CAMPAIGN_NOT_ACTIVE: '活动当前不在打卡进行中',
    TRACK_DISABLED: '该赛道当前未开放打卡',
    CAMPAIGN_FROZEN: '活动已结束',
    FORBIDDEN: '没有权限执行该操作',
    ROLE_REQUIRED: '当前账号权限不足',
    CAPABILITY_REQUIRED: '当前账号没有执行该操作的权限',
    NOT_ENTRY_OWNER: '只能查看自己的证明材料',
    NOT_FOUND: '内容不存在或已被删除',
    SIGNATURE_INVALID: '图片地址已失效，正在重新加载',
    RATE_LIMITED: '操作过于频繁，请稍后再试',
    REVIEW_CONFLICT: '该记录在你打开后被修改过，请刷新后重试',
    PENDING_REVIEWS_REMAIN: '仍有待审核记录，请先完成审核',
    SNAPSHOT_FINALIZED: '该榜单已冻结，如需重算请先解冻',
    IMPORT_ALREADY_COMMITTED: '该批次已经导入过了',
    INTERNAL_ERROR: '服务器出错了，请稍后重试',
  },
} as const

export type Messages = typeof zh
