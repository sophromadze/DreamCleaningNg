/**
 * THE CLEANER PORTAL IN THE CLEANER'S OWN LANGUAGE.
 *
 * Which language is decided by the SERVER (Helpers/CleanerLanguage) and arrives on the context as
 * a resolved code - the cleaner's own choice, falling back to their nationality. The client never
 * re-derives it, because the same map also picks the language of the assignment email, and a
 * cleaner mailed in Georgian who then opens an English page has been told we know and forgotten.
 *
 * The four languages are the four the assignment email already speaks. The vocabulary here is
 * deliberately the SAME vocabulary that email uses (EmailService.GetCleanerEmailLabels) - a cleaner
 * reads both about the same job, and two different words for "supplies" is two things to learn.
 *
 * PLURALS GO THROUGH Intl.PluralRules, not through `n === 1`. Russian needs three forms (1 спальня,
 * 2 спальни, 5 спален) and English's two-form rule would print the wrong one on most numbers;
 * Georgian needs one form after any numeral. Getting this wrong is the sort of thing that quietly
 * marks a page as not really written for the person reading it.
 */

export type PortalLanguage = 'en' | 'ka' | 'ru' | 'es';

export const PORTAL_LANGUAGES: PortalLanguage[] = ['en', 'ka', 'ru', 'es'];

/** Each language named IN ITSELF - a picker that says "Georgian" in English helps nobody. */
export const PORTAL_LANGUAGE_NAMES: Record<PortalLanguage, string> = {
  en: 'English',
  ka: 'ქართული',
  ru: 'Русский',
  es: 'Español'
};

/**
 * Three-letter forms for the narrow picker on a phone, each in its OWN script - a Georgian cleaner
 * scanning for their language should find "ქარ", not a transliteration of it. The full names stay
 * on wider screens; this is the same list, abbreviated, never a different set of choices.
 */
export const PORTAL_LANGUAGE_SHORT_NAMES: Record<PortalLanguage, string> = {
  en: 'ENG',
  ka: 'ქარ',
  ru: 'РУС',
  es: 'ESP'
};

/** BCP-47 tags for date/number formatting, matching the email's CultureInfo mapping. */
export const PORTAL_LOCALES: Record<PortalLanguage, string> = {
  en: 'en-US',
  ka: 'ka-GE',
  ru: 'ru-RU',
  es: 'es-ES'
};

/**
 * A word in every plural form the language actually distinguishes. `other` is required and is what
 * an unlisted CLDR category falls back to, so a language only has to declare the forms it uses.
 */
export interface PluralForms {
  one: string;
  few?: string;
  many?: string;
  other: string;
}

export interface PortalStrings {
  // Header
  greetingMorning: string;
  greetingAfternoon: string;
  greetingEvening: string;
  scheduleSubtitle: string;
  roleCleaner: string;
  language: string;
  languageAutomatic: string;

  // States
  notLinkedTitle: string;
  notLinkedBody: string;
  loadingJobs: string;
  loadError: string;

  // Calendar
  today: string;
  previousMonth: string;
  nextMonth: string;
  weekdays: [string, string, string, string, string, string, string];

  // The day
  dayHeaderSubtitle: string;
  cleanings: PluralForms;
  nothingScheduled: string;
  goodLuck: string;
  freeDay: string;
  completed: string;

  // The side card
  service: string;
  customerName: string;
  dateLabel: string;
  timeLabel: string;
  durationLabel: string;
  addressLabel: string;
  openInMaps: string;
  entryInstruction: string;
  detailsLabel: string;
  propertyType: string;
  apartment: string;
  house: string;
  floorTypes: string;
  extraServices: string;
  supplies: string;
  suppliesBring: string;
  suppliesProvided: string;
  /** The "Cleaning Essentials" extra: paper towels, garbage bags, toilet brush. */
  essentials: string;
  essentialsBring: string;
  essentialsProvided: string;
  customerInstructions: string;
  cleanerInstructions: string;

  // Service lines
  studio: string;
  bedrooms: PluralForms;
  bathrooms: PluralForms;
  levels: PluralForms;
  cleaners: PluralForms;
  hours: PluralForms;
  squareFeet: string;

  // Duration units
  hourUnit: string;
  minuteUnit: string;
}

const EN: PortalStrings = {
  greetingMorning: 'Good morning',
  greetingAfternoon: 'Good afternoon',
  greetingEvening: 'Good evening',
  scheduleSubtitle: 'Here is your cleaning schedule.',
  roleCleaner: 'Cleaner',
  language: 'Language',
  languageAutomatic: 'Automatic',

  notLinkedTitle: 'Your account is not linked yet',
  notLinkedBody: 'Your login is not connected to a cleaner profile, so we cannot show your jobs. Please ask the office to link your account, then sign in again.',
  loadingJobs: 'Loading your jobs...',
  loadError: 'Could not load your jobs. Please try again.',

  today: 'Today',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

  dayHeaderSubtitle: 'Your cleanings for this day.',
  cleanings: { one: 'Cleaning', other: 'Cleanings' },
  nothingScheduled: 'Nothing scheduled for this day.',
  goodLuck: 'Good luck today!',
  freeDay: 'A free day.',
  completed: 'Completed',

  service: 'Service',
  customerName: 'Name',
  dateLabel: 'Date',
  timeLabel: 'Time',
  durationLabel: 'Service duration',
  addressLabel: 'Address',
  openInMaps: 'Open in Maps',
  entryInstruction: 'How to get in',
  detailsLabel: 'Details',
  propertyType: 'Property type',
  apartment: 'Apartment',
  house: 'House',
  floorTypes: 'Floor types',
  extraServices: 'Extra services',
  supplies: 'Supplies',
  suppliesBring: 'Bring cleaning supplies',
  suppliesProvided: 'Supplies not needed - the customer provides them',
  essentials: 'Essentials',
  essentialsBring: 'Bring the essentials: paper towels, garbage bags, toilet brush, broom',
  essentialsProvided: 'Essentials not needed - the customer provides them',
  customerInstructions: 'Instructions from the customer',
  cleanerInstructions: 'Instructions from the office',

  studio: 'Studio',
  bedrooms: { one: 'Bedroom', other: 'Bedrooms' },
  bathrooms: { one: 'Bathroom', other: 'Bathrooms' },
  levels: { one: 'Level', other: 'Levels' },
  cleaners: { one: 'Cleaner', other: 'Cleaners' },
  hours: { one: 'Hour', other: 'Hours' },
  squareFeet: 'sq ft',

  hourUnit: 'h',
  minuteUnit: 'min'
};

const KA: PortalStrings = {
  // The three time-of-day forms, matching English. Two of them were the generic "hello"
  // (გამარჯობა), which is correct Georgian but not a greeting that says anything: a cleaner
  // opening the page at 8am and at 4pm read the same word, while every other language on the page
  // moved with the clock. მშვიდობისა takes the time of day in front of it exactly as "Good ..."
  // does - დილა morning, დღე day, საღამო evening.
  greetingMorning: 'დილა მშვიდობისა',
  greetingAfternoon: 'დღე მშვიდობისა',
  greetingEvening: 'საღამო მშვიდობისა',
  scheduleSubtitle: 'აი თქვენი დასუფთავების განრიგი.',
  roleCleaner: 'ქლინერი',
  language: 'ენა',
  languageAutomatic: 'ავტომატური',

  notLinkedTitle: 'თქვენი ანგარიში ჯერ არ არის დაკავშირებული',
  notLinkedBody: 'თქვენი ანგარიში არ არის დაკავშირებული ქლინერის პროფილთან, ამიტომ ვერ ვაჩვენებთ თქვენს სამუშაოებს. გთხოვთ სთხოვოთ ოფისს ანგარიშის დაკავშირება და შემდეგ ხელახლა შეხვიდეთ.',
  loadingJobs: 'იტვირთება თქვენი სამუშაოები...',
  loadError: 'ვერ ჩაიტვირთა თქვენი სამუშაოები. გთხოვთ სცადოთ ხელახლა.',

  today: 'დღეს',
  previousMonth: 'წინა თვე',
  nextMonth: 'შემდეგი თვე',
  weekdays: ['კვი', 'ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ'],

  dayHeaderSubtitle: 'თქვენი დასუფთავებები ამ დღისთვის.',
  cleanings: { one: 'დასუფთავება', other: 'დასუფთავება' },
  nothingScheduled: 'ამ დღეს არაფერია დაგეგმილი.',
  goodLuck: 'წარმატებები დღეს!',
  freeDay: 'თავისუფალი დღე.',
  completed: 'დასრულებული',

  service: 'სერვისი',
  customerName: 'სახელი',
  dateLabel: 'თარიღი',
  timeLabel: 'დრო',
  durationLabel: 'სერვისის დრო',
  addressLabel: 'მისამართი',
  openInMaps: 'რუკაზე ნახვა',
  entryInstruction: 'შესვლის ინსტრუქცია',
  detailsLabel: 'დეტალები',
  propertyType: 'ქონების ტიპი',
  apartment: 'ბინა',
  house: 'კერძო სახლი',
  floorTypes: 'იატაკის ტიპი',
  extraServices: 'დამატებითი სერვისები',
  supplies: 'ხსნარები',
  suppliesBring: 'წაიღეთ საწმენდი საშუალებები',
  suppliesProvided: 'ხსნარები არ არის საჭირო - მომხმარებელი უზრუნველყოფს',
  essentials: 'საწმენდი ნივთები',
  essentialsBring: 'წაიღეთ საწმენდი ნივთები: ხელსახოცები, ნაგვის პარკები, უნიტაზის ჯაგრისი, ცოცხი',
  essentialsProvided: 'საწმენდი ნივთები არ არის საჭირო - მომხმარებელი უზრუნველყოფს',
  customerInstructions: 'ინსტრუქცია მომხმარებლისგან',
  cleanerInstructions: 'ინსტრუქცია ოფისისგან',

  studio: 'სტუდიო',
  bedrooms: { one: 'საძინებელი', other: 'საძინებელი' },
  bathrooms: { one: 'სველი წერტილი', other: 'სველი წერტილი' },
  levels: { one: 'სართული', other: 'სართული' },
  cleaners: { one: 'ქლინერი', other: 'ქლინერი' },
  hours: { one: 'საათი', other: 'საათი' },
  squareFeet: 'კვ. ფუტი',

  hourUnit: 'სთ',
  minuteUnit: 'წთ'
};

const RU: PortalStrings = {
  greetingMorning: 'Доброе утро',
  greetingAfternoon: 'Добрый день',
  greetingEvening: 'Добрый вечер',
  scheduleSubtitle: 'Вот ваше расписание уборок.',
  roleCleaner: 'Клинер',
  language: 'Язык',
  languageAutomatic: 'Автоматически',

  notLinkedTitle: 'Ваш аккаунт ещё не привязан',
  notLinkedBody: 'Ваш аккаунт не связан с профилем клинера, поэтому мы не можем показать ваши заказы. Пожалуйста, попросите офис привязать аккаунт и войдите снова.',
  loadingJobs: 'Загружаем ваши заказы...',
  loadError: 'Не удалось загрузить ваши заказы. Пожалуйста, попробуйте ещё раз.',

  today: 'Сегодня',
  previousMonth: 'Предыдущий месяц',
  nextMonth: 'Следующий месяц',
  weekdays: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],

  dayHeaderSubtitle: 'Ваши уборки на этот день.',
  cleanings: { one: 'уборка', few: 'уборки', many: 'уборок', other: 'уборки' },
  nothingScheduled: 'На этот день ничего не запланировано.',
  goodLuck: 'Удачи сегодня!',
  freeDay: 'Свободный день.',
  completed: 'Выполнено',

  service: 'Услуга',
  customerName: 'Имя',
  dateLabel: 'Дата',
  timeLabel: 'Время',
  durationLabel: 'Длительность услуги',
  addressLabel: 'Адрес',
  openInMaps: 'Открыть на карте',
  entryInstruction: 'Инструкция по входу',
  detailsLabel: 'Детали',
  propertyType: 'Тип жилья',
  apartment: 'Квартира',
  house: 'Частный дом',
  floorTypes: 'Тип пола',
  extraServices: 'Дополнительные услуги',
  supplies: 'Чистящие средства',
  suppliesBring: 'Возьмите с собой чистящие средства',
  suppliesProvided: 'Средства не нужны - их предоставляет клиент',
  essentials: 'Расходные материалы',
  essentialsBring: 'Возьмите расходные материалы: бумажные полотенца, мусорные пакеты, ёршик для унитаза, веник',
  essentialsProvided: 'Расходные материалы не нужны - их предоставляет клиент',
  customerInstructions: 'Инструкции от клиента',
  cleanerInstructions: 'Инструкции от офиса',

  studio: 'Студия',
  bedrooms: { one: 'спальня', few: 'спальни', many: 'спален', other: 'спальни' },
  bathrooms: { one: 'ванная', few: 'ванные', many: 'ванных', other: 'ванные' },
  levels: { one: 'этаж', few: 'этажа', many: 'этажей', other: 'этажа' },
  cleaners: { one: 'клинер', few: 'клинера', many: 'клинеров', other: 'клинера' },
  hours: { one: 'час', few: 'часа', many: 'часов', other: 'часа' },
  squareFeet: 'кв. футов',

  hourUnit: 'ч',
  minuteUnit: 'мин'
};

const ES: PortalStrings = {
  greetingMorning: 'Buenos días',
  greetingAfternoon: 'Buenas tardes',
  greetingEvening: 'Buenas noches',
  scheduleSubtitle: 'Aquí está su horario de limpiezas.',
  roleCleaner: 'Limpiador',
  language: 'Idioma',
  languageAutomatic: 'Automático',

  notLinkedTitle: 'Su cuenta aún no está vinculada',
  notLinkedBody: 'Su cuenta no está conectada a un perfil de limpiador, por lo que no podemos mostrar sus trabajos. Por favor, pida a la oficina que vincule su cuenta y vuelva a iniciar sesión.',
  loadingJobs: 'Cargando sus trabajos...',
  loadError: 'No se pudieron cargar sus trabajos. Por favor, inténtelo de nuevo.',

  today: 'Hoy',
  previousMonth: 'Mes anterior',
  nextMonth: 'Mes siguiente',
  weekdays: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],

  dayHeaderSubtitle: 'Sus limpiezas para este día.',
  cleanings: { one: 'limpieza', other: 'limpiezas' },
  nothingScheduled: 'No hay nada programado para este día.',
  goodLuck: '¡Buena suerte hoy!',
  freeDay: 'Un día libre.',
  completed: 'Completado',

  service: 'Servicio',
  customerName: 'Nombre',
  dateLabel: 'Fecha',
  timeLabel: 'Hora',
  durationLabel: 'Duración del servicio',
  addressLabel: 'Dirección',
  openInMaps: 'Abrir en Mapas',
  entryInstruction: 'Instrucciones de entrada',
  detailsLabel: 'Detalles',
  propertyType: 'Tipo de propiedad',
  apartment: 'Apartamento',
  house: 'Casa',
  floorTypes: 'Tipo de suelo',
  extraServices: 'Servicios adicionales',
  supplies: 'Productos de limpieza',
  suppliesBring: 'Lleve los productos de limpieza',
  suppliesProvided: 'No hacen falta productos - los proporciona el cliente',
  essentials: 'Artículos básicos',
  essentialsBring: 'Lleve los artículos básicos: toallas de papel, bolsas de basura, escobilla de inodoro, escoba',
  essentialsProvided: 'No hacen falta artículos básicos - los proporciona el cliente',
  customerInstructions: 'Instrucciones del cliente',
  cleanerInstructions: 'Instrucciones de la oficina',

  studio: 'Estudio',
  bedrooms: { one: 'dormitorio', other: 'dormitorios' },
  bathrooms: { one: 'baño', other: 'baños' },
  levels: { one: 'planta', other: 'plantas' },
  cleaners: { one: 'limpiador', other: 'limpiadores' },
  hours: { one: 'hora', other: 'horas' },
  squareFeet: 'pies cuadrados',

  hourUnit: 'h',
  minuteUnit: 'min'
};

export const PORTAL_STRINGS: Record<PortalLanguage, PortalStrings> = {
  en: EN, ka: KA, ru: RU, es: ES
};

/** Anything the server has not sent, or a stale code, reads in English rather than blank. */
export function resolvePortalLanguage(code: string | null | undefined): PortalLanguage {
  const c = (code || '').trim().toLowerCase();
  return (PORTAL_LANGUAGES as string[]).includes(c) ? (c as PortalLanguage) : 'en';
}

export function portalStrings(language: PortalLanguage): PortalStrings {
  return PORTAL_STRINGS[language];
}

/**
 * The right plural form for a count, through Intl.PluralRules so Russian's three forms and
 * Georgian's one are both correct. A category the language did not declare falls back to `other`,
 * which is the form every language here defines.
 */
export function plural(language: PortalLanguage, count: number, forms: PluralForms): string {
  let category: Intl.LDMLPluralRule = 'other';
  try {
    category = new Intl.PluralRules(PORTAL_LOCALES[language]).select(count);
  } catch {
    // An engine without the locale data still gets a sensible English-shaped answer.
    category = count === 1 ? 'one' : 'other';
  }

  if (category === 'one') return forms.one;
  if (category === 'few' && forms.few) return forms.few;
  if (category === 'many' && forms.many) return forms.many;
  return forms.other;
}

/** "2 Bedrooms" / "2 спальни" / "2 საძინებელი" - the number and its own word. */
export function countedLabel(language: PortalLanguage, count: number, forms: PluralForms): string {
  return `${count} ${plural(language, count, forms)}`;
}

/**
 * A priced service line as a cleaner reads it. Known catalogue keys become a counted noun in their
 * own language; anything else falls back to the stored English name, which is better than hiding a
 * line we did not anticipate.
 *
 * Matched on the KEY, never the name or the Id - both differ between dev and production.
 */
export function formatServiceLine(
  line: { name: string; quantity: number; serviceKey?: string | null },
  language: PortalLanguage
): string {
  const s = portalStrings(language);
  const key = (line.serviceKey || '').trim().toLowerCase();
  const qty = line.quantity;

  switch (key) {
    case 'bedrooms':
      // A studio has no bedrooms, and "0 Bedrooms" is not what anybody calls that.
      return qty === 0 ? s.studio : countedLabel(language, qty, s.bedrooms);
    case 'bathrooms':
      return countedLabel(language, qty, s.bathrooms);
    case 'levels':
      return countedLabel(language, qty, s.levels);
    case 'cleaners':
      return countedLabel(language, qty, s.cleaners);
    case 'hours':
      return countedLabel(language, qty, s.hours);
    case 'sqft':
      return `${qty.toLocaleString(PORTAL_LOCALES[language])} ${s.squareFeet}`;
    default:
      return qty > 1 ? `${line.name} x ${qty}` : line.name;
  }
}

/** "6h 30min", in the reader's units. Mirrors EmailService.FormatDurationLocalized. */
export function formatPortalDuration(minutes: number, language: PortalLanguage): string {
  const s = portalStrings(language);
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;

  if (hours === 0 && mins === 0) return `0 ${s.minuteUnit}`;
  if (hours === 0) return `${mins} ${s.minuteUnit}`;
  if (mins === 0) return `${hours} ${s.hourUnit}`;
  return `${hours} ${s.hourUnit} ${mins} ${s.minuteUnit}`;
}
