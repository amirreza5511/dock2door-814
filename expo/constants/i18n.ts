/**
 * Help Center internationalization.
 *
 * - `LANGUAGES` is the list of supported languages shown in the picker.
 * - `UI` holds hand-translated, instant UI chrome strings (headers, buttons…).
 * - Rich manual content (role overviews, screen summaries, actions) is translated
 *   on demand by the AI translator in `@/lib/translate`, so it always stays in sync
 *   with the English source without a giant hand-maintained dictionary.
 */

export type LangCode = 'en' | 'fa' | 'hi' | 'fr' | 'es' | 'zh' | 'pa';

export interface LangDef {
  code: LangCode;
  /** English name of the language */
  label: string;
  /** Endonym (name in its own script) */
  native: string;
  /** Whether the script reads right-to-left */
  rtl: boolean;
  /** How to name this language to the AI when asking it to translate / reply */
  aiName: string;
}

export const LANGUAGES: LangDef[] = [
  { code: 'en', label: 'English', native: 'English', rtl: false, aiName: 'English' },
  { code: 'fa', label: 'Persian', native: 'فارسی', rtl: true, aiName: 'Persian (Farsi)' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', rtl: false, aiName: 'Hindi' },
  { code: 'fr', label: 'French', native: 'Français', rtl: false, aiName: 'French' },
  { code: 'es', label: 'Spanish', native: 'Español', rtl: false, aiName: 'Spanish' },
  { code: 'zh', label: 'Chinese', native: '中文', rtl: false, aiName: 'Simplified Chinese' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ', rtl: false, aiName: 'Punjabi (Gurmukhi script)' },
];

export const DEFAULT_LANG: LangCode = 'en';

export function isLangCode(v: string): v is LangCode {
  return LANGUAGES.some((l) => l.code === v);
}

export function getLang(code: LangCode): LangDef {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

const EN = {
  helpCenter: 'Help Center',
  helpCenterSub: 'Manuals, guides & AI help',
  searchPlaceholder: 'Search screens, roles, how-tos…',
  results: 'RESULTS',
  result: 'RESULT',
  askAi: 'Ask AI for help',
  askAiSub: 'Describe what you’re trying to do and get a step-by-step answer.',
  yourManual: 'YOUR MANUAL',
  allManuals: 'ALL ROLE MANUALS',
  everywhere: 'EVERYWHERE IN THE APP',
  noMatches: 'No matches. Try the AI assistant below.',
  screensStepByStep: '{n} SCREENS · STEP BY STEP',
  openScreen: 'Open this screen',
  stillStuck: 'Still stuck? Ask the AI assistant',
  helpAssistant: 'Help Assistant',
  answersFromManual: 'Answers from the app manual',
  howCanIHelp: 'How can I help?',
  askAnythingSub: 'Ask me anything about how Dock2Door works — I’ll point you to the exact screen and steps.',
  askPlaceholder: 'Ask about any screen or task…',
  thinking: 'Thinking…',
  manualNotFound: 'Manual not found.',
  goBack: 'Go back',
  chooseLanguage: 'Choose language',
  translating: 'Translating…',
  manualSuffix: 'Manual',
};

export type UiKey = keyof typeof EN;

export const UI: Record<LangCode, Record<UiKey, string>> = {
  en: EN,
  fa: {
    helpCenter: 'مرکز راهنما',
    helpCenterSub: 'راهنماها، آموزش‌ها و کمک هوش مصنوعی',
    searchPlaceholder: 'جستجوی صفحه‌ها، نقش‌ها و آموزش‌ها…',
    results: 'نتیجه',
    result: 'نتیجه',
    askAi: 'از هوش مصنوعی کمک بگیرید',
    askAiSub: 'بنویسید می‌خواهید چه کاری انجام دهید تا پاسخ گام‌به‌گام بگیرید.',
    yourManual: 'راهنمای شما',
    allManuals: 'راهنمای همهٔ نقش‌ها',
    everywhere: 'در همه‌جای برنامه',
    noMatches: 'موردی پیدا نشد. از دستیار هوش مصنوعی زیر استفاده کنید.',
    screensStepByStep: '{n} صفحه · گام‌به‌گام',
    openScreen: 'باز کردن این صفحه',
    stillStuck: 'هنوز گیر کرده‌اید؟ از دستیار هوش مصنوعی بپرسید',
    helpAssistant: 'دستیار راهنما',
    answersFromManual: 'پاسخ‌ها از راهنمای برنامه',
    howCanIHelp: 'چطور می‌توانم کمک کنم؟',
    askAnythingSub: 'هر چیزی دربارهٔ نحوهٔ کار Dock2Door بپرسید — شما را به صفحه و مراحل دقیق راهنمایی می‌کنم.',
    askPlaceholder: 'دربارهٔ هر صفحه یا کاری بپرسید…',
    thinking: 'در حال فکر کردن…',
    manualNotFound: 'راهنما پیدا نشد.',
    goBack: 'بازگشت',
    chooseLanguage: 'انتخاب زبان',
    translating: 'در حال ترجمه…',
    manualSuffix: 'راهنما',
  },
  hi: {
    helpCenter: 'सहायता केंद्र',
    helpCenterSub: 'मैनुअल, गाइड और AI सहायता',
    searchPlaceholder: 'स्क्रीन, भूमिकाएँ, कैसे करें खोजें…',
    results: 'परिणाम',
    result: 'परिणाम',
    askAi: 'AI से मदद माँगें',
    askAiSub: 'बताएँ कि आप क्या करना चाहते हैं और चरण-दर-चरण उत्तर पाएँ।',
    yourManual: 'आपका मैनुअल',
    allManuals: 'सभी भूमिका मैनुअल',
    everywhere: 'ऐप में हर जगह',
    noMatches: 'कोई मिलान नहीं। नीचे AI सहायक आज़माएँ।',
    screensStepByStep: '{n} स्क्रीन · चरण-दर-चरण',
    openScreen: 'यह स्क्रीन खोलें',
    stillStuck: 'अब भी अटके हैं? AI सहायक से पूछें',
    helpAssistant: 'सहायता सहायक',
    answersFromManual: 'ऐप मैनुअल से उत्तर',
    howCanIHelp: 'मैं कैसे मदद करूँ?',
    askAnythingSub: 'Dock2Door कैसे काम करता है, कुछ भी पूछें — मैं आपको सही स्क्रीन और चरण बताऊँगा।',
    askPlaceholder: 'किसी भी स्क्रीन या कार्य के बारे में पूछें…',
    thinking: 'सोच रहा हूँ…',
    manualNotFound: 'मैनुअल नहीं मिला।',
    goBack: 'वापस जाएँ',
    chooseLanguage: 'भाषा चुनें',
    translating: 'अनुवाद हो रहा है…',
    manualSuffix: 'मैनुअल',
  },
  fr: {
    helpCenter: 'Centre d’aide',
    helpCenterSub: 'Manuels, guides et aide IA',
    searchPlaceholder: 'Rechercher écrans, rôles, tutoriels…',
    results: 'RÉSULTATS',
    result: 'RÉSULTAT',
    askAi: 'Demander de l’aide à l’IA',
    askAiSub: 'Décrivez ce que vous voulez faire et obtenez une réponse étape par étape.',
    yourManual: 'VOTRE MANUEL',
    allManuals: 'TOUS LES MANUELS DE RÔLE',
    everywhere: 'PARTOUT DANS L’APP',
    noMatches: 'Aucun résultat. Essayez l’assistant IA ci-dessous.',
    screensStepByStep: '{n} ÉCRANS · ÉTAPE PAR ÉTAPE',
    openScreen: 'Ouvrir cet écran',
    stillStuck: 'Toujours bloqué ? Demandez à l’assistant IA',
    helpAssistant: 'Assistant d’aide',
    answersFromManual: 'Réponses tirées du manuel',
    howCanIHelp: 'Comment puis-je aider ?',
    askAnythingSub: 'Posez-moi n’importe quelle question sur le fonctionnement de Dock2Door — je vous indiquerai l’écran et les étapes exacts.',
    askPlaceholder: 'Posez une question sur un écran ou une tâche…',
    thinking: 'Réflexion…',
    manualNotFound: 'Manuel introuvable.',
    goBack: 'Retour',
    chooseLanguage: 'Choisir la langue',
    translating: 'Traduction…',
    manualSuffix: 'Manuel',
  },
  es: {
    helpCenter: 'Centro de ayuda',
    helpCenterSub: 'Manuales, guías y ayuda con IA',
    searchPlaceholder: 'Buscar pantallas, roles, tutoriales…',
    results: 'RESULTADOS',
    result: 'RESULTADO',
    askAi: 'Pedir ayuda a la IA',
    askAiSub: 'Describe lo que quieres hacer y obtén una respuesta paso a paso.',
    yourManual: 'TU MANUAL',
    allManuals: 'TODOS LOS MANUALES DE ROL',
    everywhere: 'EN TODA LA APP',
    noMatches: 'Sin resultados. Prueba el asistente de IA abajo.',
    screensStepByStep: '{n} PANTALLAS · PASO A PASO',
    openScreen: 'Abrir esta pantalla',
    stillStuck: '¿Sigues atascado? Pregunta al asistente de IA',
    helpAssistant: 'Asistente de ayuda',
    answersFromManual: 'Respuestas del manual de la app',
    howCanIHelp: '¿Cómo puedo ayudarte?',
    askAnythingSub: 'Pregúntame cualquier cosa sobre cómo funciona Dock2Door — te indicaré la pantalla y los pasos exactos.',
    askPlaceholder: 'Pregunta sobre cualquier pantalla o tarea…',
    thinking: 'Pensando…',
    manualNotFound: 'Manual no encontrado.',
    goBack: 'Volver',
    chooseLanguage: 'Elegir idioma',
    translating: 'Traduciendo…',
    manualSuffix: 'Manual',
  },
  zh: {
    helpCenter: '帮助中心',
    helpCenterSub: '手册、指南和 AI 帮助',
    searchPlaceholder: '搜索页面、角色、操作指南…',
    results: '条结果',
    result: '条结果',
    askAi: '向 AI 求助',
    askAiSub: '描述你想做的事，获得分步解答。',
    yourManual: '你的手册',
    allManuals: '所有角色手册',
    everywhere: '应用中随处可用',
    noMatches: '没有匹配项。请试试下面的 AI 助手。',
    screensStepByStep: '{n} 个页面 · 分步说明',
    openScreen: '打开此页面',
    stillStuck: '还有疑问？问问 AI 助手',
    helpAssistant: '帮助助手',
    answersFromManual: '答案来自应用手册',
    howCanIHelp: '我能帮你什么？',
    askAnythingSub: '关于 Dock2Door 的任何用法都可以问我——我会为你指出确切的页面和步骤。',
    askPlaceholder: '询问任何页面或任务…',
    thinking: '思考中…',
    manualNotFound: '未找到手册。',
    goBack: '返回',
    chooseLanguage: '选择语言',
    translating: '翻译中…',
    manualSuffix: '手册',
  },
  pa: {
    helpCenter: 'ਮਦਦ ਕੇਂਦਰ',
    helpCenterSub: 'ਮੈਨੂਅਲ, ਗਾਈਡ ਅਤੇ AI ਮਦਦ',
    searchPlaceholder: 'ਸਕ੍ਰੀਨ, ਭੂਮਿਕਾਵਾਂ, ਤਰੀਕੇ ਖੋਜੋ…',
    results: 'ਨਤੀਜੇ',
    result: 'ਨਤੀਜਾ',
    askAi: 'AI ਤੋਂ ਮਦਦ ਮੰਗੋ',
    askAiSub: 'ਦੱਸੋ ਤੁਸੀਂ ਕੀ ਕਰਨਾ ਚਾਹੁੰਦੇ ਹੋ ਅਤੇ ਕਦਮ-ਦਰ-ਕਦਮ ਜਵਾਬ ਪਾਓ।',
    yourManual: 'ਤੁਹਾਡਾ ਮੈਨੂਅਲ',
    allManuals: 'ਸਾਰੇ ਭੂਮਿਕਾ ਮੈਨੂਅਲ',
    everywhere: 'ਐਪ ਵਿੱਚ ਹਰ ਥਾਂ',
    noMatches: 'ਕੋਈ ਮੇਲ ਨਹੀਂ। ਹੇਠਾਂ AI ਸਹਾਇਕ ਅਜ਼ਮਾਓ।',
    screensStepByStep: '{n} ਸਕ੍ਰੀਨ · ਕਦਮ-ਦਰ-ਕਦਮ',
    openScreen: 'ਇਹ ਸਕ੍ਰੀਨ ਖੋਲ੍ਹੋ',
    stillStuck: 'ਅਜੇ ਵੀ ਅਟਕੇ ਹੋ? AI ਸਹਾਇਕ ਤੋਂ ਪੁੱਛੋ',
    helpAssistant: 'ਮਦਦ ਸਹਾਇਕ',
    answersFromManual: 'ਐਪ ਮੈਨੂਅਲ ਤੋਂ ਜਵਾਬ',
    howCanIHelp: 'ਮੈਂ ਕਿਵੇਂ ਮਦਦ ਕਰਾਂ?',
    askAnythingSub: 'Dock2Door ਕਿਵੇਂ ਕੰਮ ਕਰਦਾ ਹੈ, ਕੁਝ ਵੀ ਪੁੱਛੋ — ਮੈਂ ਤੁਹਾਨੂੰ ਸਹੀ ਸਕ੍ਰੀਨ ਅਤੇ ਕਦਮ ਦੱਸਾਂਗਾ।',
    askPlaceholder: 'ਕਿਸੇ ਵੀ ਸਕ੍ਰੀਨ ਜਾਂ ਕੰਮ ਬਾਰੇ ਪੁੱਛੋ…',
    thinking: 'ਸੋਚ ਰਿਹਾ ਹਾਂ…',
    manualNotFound: 'ਮੈਨੂਅਲ ਨਹੀਂ ਮਿਲਿਆ।',
    goBack: 'ਵਾਪਸ ਜਾਓ',
    chooseLanguage: 'ਭਾਸ਼ਾ ਚੁਣੋ',
    translating: 'ਅਨੁਵਾਦ ਹੋ ਰਿਹਾ ਹੈ…',
    manualSuffix: 'ਮੈਨੂਅਲ',
  },
};

/** Starter prompts for the AI help chat, per language. */
export const CHAT_SUGGESTIONS: Record<LangCode, string[]> = {
  en: [
    'How do I post a load and get a quote?',
    'Where do I take pickup and delivery photos?',
    'How does a fleet dispatcher assign a driver?',
    'Where can I track my truck live?',
  ],
  fa: [
    'چطور یک بار ثبت کنم و قیمت بگیرم؟',
    'عکس بارگیری و تحویل را کجا بگیرم؟',
    'دیسپچر ناوگان چطور راننده را تخصیص می‌دهد؟',
    'کامیونم را کجا زنده ردیابی کنم؟',
  ],
  hi: [
    'लोड कैसे पोस्ट करूँ और कोटेशन पाऊँ?',
    'पिकअप और डिलीवरी फ़ोटो कहाँ लूँ?',
    'फ्लीट डिस्पैचर ड्राइवर कैसे असाइन करता है?',
    'अपने ट्रक को लाइव कहाँ ट्रैक करूँ?',
  ],
  fr: [
    'Comment publier un chargement et obtenir un devis ?',
    'Où prendre les photos de ramassage et de livraison ?',
    'Comment un répartiteur de flotte assigne-t-il un chauffeur ?',
    'Où suivre mon camion en direct ?',
  ],
  es: [
    '¿Cómo publico una carga y obtengo una cotización?',
    '¿Dónde tomo las fotos de recogida y entrega?',
    '¿Cómo asigna un conductor el despachador de flota?',
    '¿Dónde rastreo mi camión en vivo?',
  ],
  zh: [
    '如何发布货运并获取报价？',
    '在哪里拍摄取货和送货照片？',
    '车队调度员如何指派司机？',
    '在哪里实时追踪我的卡车？',
  ],
  pa: [
    'ਲੋਡ ਕਿਵੇਂ ਪੋਸਟ ਕਰਾਂ ਅਤੇ ਕੀਮਤ ਪਾਵਾਂ?',
    'ਪਿਕਅੱਪ ਅਤੇ ਡਿਲੀਵਰੀ ਫੋਟੋ ਕਿੱਥੇ ਲਵਾਂ?',
    'ਫਲੀਟ ਡਿਸਪੈਚਰ ਡਰਾਈਵਰ ਕਿਵੇਂ ਸੌਂਪਦਾ ਹੈ?',
    'ਆਪਣੇ ਟਰੱਕ ਨੂੰ ਲਾਈਵ ਕਿੱਥੇ ਟਰੈਕ ਕਰਾਂ?',
  ],
};

/** Convenience translator for the static UI chrome. */
export function tUI(lang: LangCode, key: UiKey): string {
  return UI[lang]?.[key] ?? UI.en[key];
}
