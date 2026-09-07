// TH/EN dictionary + toggle. Thai is the default language; code, comments,
// and identifiers stay in English (plan.md "UI language"). Persisted in
// localStorage. No build step, no ES modules — plain global (see
// ~/CLAUDE.md JS conventions).
'use strict';

const I18N_STORAGE_KEY = 'suvida_v1_lang';

const DICT = {
  th: {
    app_name: 'Suvida Piano Studio',
    lang_toggle_th: 'ไทย',
    lang_toggle_en: 'EN',

    nav_schedule: 'ตารางเรียน',
    nav_calendar: 'ปฏิทิน',
    nav_notifications: 'แจ้งเตือน',
    nav_log: 'ประวัติ',
    nav_settings: 'ตั้งค่า',
    nav_logout: 'ออกจากระบบ',
    nav_admins: 'รายชื่อครู',

    weekday_short_0: 'อา',
    weekday_short_1: 'จ',
    weekday_short_2: 'อ',
    weekday_short_3: 'พ',
    weekday_short_4: 'พฤ',
    weekday_short_5: 'ศ',
    weekday_short_6: 'ส',
    weekday_full_0: 'วันอาทิตย์',
    weekday_full_1: 'วันจันทร์',
    weekday_full_2: 'วันอังคาร',
    weekday_full_3: 'วันพุธ',
    weekday_full_4: 'วันพฤหัสบดี',
    weekday_full_5: 'วันศุกร์',
    weekday_full_6: 'วันเสาร์',

    month_1: 'มกราคม', month_2: 'กุมภาพันธ์', month_3: 'มีนาคม', month_4: 'เมษายน',
    month_5: 'พฤษภาคม', month_6: 'มิถุนายน', month_7: 'กรกฎาคม', month_8: 'สิงหาคม',
    month_9: 'กันยายน', month_10: 'ตุลาคม', month_11: 'พฤศจิกายน', month_12: 'ธันวาคม',

    calendar_prev: 'เดือนก่อนหน้า',
    calendar_next: 'เดือนถัดไป',
    calendar_today: 'วันนี้',

    common_loading: 'กำลังโหลด...',
    common_error_generic: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง',
    common_error_network: 'เชื่อมต่อไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
    common_save: 'บันทึก',
    common_cancel: 'ยกเลิก',
    common_close: 'ปิด',
    common_confirm: 'ยืนยัน',
    common_delete: 'ลบ',
    common_edit: 'แก้ไข',
    common_add: 'เพิ่ม',
    common_back: 'ย้อนกลับ',
    common_copy: 'คัดลอก',
    common_copied: 'คัดลอกแล้ว',
    common_none: 'ไม่มี',
    common_optional: 'ไม่บังคับ',
    common_load_more: 'โหลดเพิ่มเติม',
    common_retry: 'ลองใหม่',

    // Booker page
    booker_tab_book: 'จองเวลาเรียน',
    booker_tab_history: 'ประวัติการจอง',
    booker_pick_day: 'เลือกวันที่ต้องการเรียน',
    booker_no_slots_month: 'เดือนนี้ยังไม่มีคิวว่าง',
    booker_day_slots_title: 'เวลาว่างวันที่ {date}',
    booker_no_slots_day: 'วันนี้ไม่มีคิวว่างแล้ว',
    booker_slots_count: 'ว่าง {count} คิว',
    booker_day_none: 'ไม่มีคิว',
    booker_slot_book_btn: 'จองเวลานี้',
    booker_form_title: 'กรอกข้อมูลเพื่อจอง',
    booker_form_slot_label: 'เวลาที่เลือก',
    booker_form_name: 'ชื่อผู้เรียน',
    booker_form_phone: 'เบอร์โทรศัพท์',
    booker_form_submit: 'ยืนยันการจอง',
    booker_form_name_required: 'กรุณากรอกชื่อ',
    booker_form_phone_required: 'กรุณากรอกเบอร์โทรศัพท์',
    booker_book_success_title: 'จองสำเร็จ',
    booker_book_success_body: 'บันทึกเวลาเรียนของคุณแล้ว ระบบได้บันทึกไว้ในเครื่องนี้ สามารถดูได้ที่แท็บ "ประวัติการจอง"',
    booker_book_conflict: 'ขออภัย เวลานี้เพิ่งถูกจองไปหรือไม่ว่างแล้ว กรุณาเลือกเวลาอื่น',
    booker_book_rate_limited: 'มีการจองถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
    booker_teacher_not_found: 'ไม่พบหน้าจองนี้ ลิงก์อาจไม่ถูกต้องหรือถูกเปลี่ยนแล้ว',
    booker_history_local_title: 'การจองจากเครื่องนี้',
    booker_history_none_local: 'ยังไม่มีการจองจากเครื่องนี้',
    booker_history_lookup_title: 'ค้นหาด้วยเบอร์โทรศัพท์',
    booker_history_lookup_phone: 'เบอร์โทรศัพท์',
    booker_history_lookup_btn: 'ค้นหา',
    booker_history_lookup_none: 'ไม่พบการจองที่ใช้งานอยู่สำหรับเบอร์นี้',
    booker_history_cancel_btn: 'ยกเลิกการจอง',
    booker_history_cancel_locked: 'ยกเลิกไม่ได้ (เหลือน้อยกว่า 24 ชม.)',
    booker_history_cancel_confirm: 'ยืนยันยกเลิกเวลาเรียนนี้ใช่หรือไม่?',
    booker_history_cancel_success: 'ยกเลิกการจองแล้ว',
    booker_history_cancel_failed: 'ไม่สามารถยกเลิกได้ กรุณาตรวจสอบข้อมูลอีกครั้ง',
    booker_history_rate_limited: 'ค้นหาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',

    // Login (shared owner/admin)
    login_title: 'เข้าสู่ระบบ',
    login_username: 'ชื่อผู้ใช้',
    login_password: 'รหัสผ่าน',
    login_remember: 'จดจำการเข้าสู่ระบบ',
    login_submit: 'เข้าสู่ระบบ',
    login_invalid: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
    login_rate_limited: 'พยายามเข้าสู่ระบบถี่เกินไป กรุณารอสักครู่',

    // Admin — schedule
    schedule_no_activation_banner: 'ยังไม่มีสัปดาห์ที่เปิดให้จองในอนาคต นักเรียนจะไม่เห็นคิวว่างเลย',
    schedule_template_title: 'ตารางเวลาประจำสัปดาห์',
    schedule_template_hint: 'การแก้ไขตารางนี้จะไม่มีผลย้อนหลังกับสัปดาห์ที่เปิดจองไปแล้ว — ใช้ "ใช้ตารางซ้ำ" กับสัปดาห์นั้นเพื่ออัปเดต',
    schedule_template_add_weekday: 'วัน',
    schedule_template_add_time: 'เวลาเริ่ม',
    schedule_template_add_btn: 'เพิ่มช่วงเวลา',
    schedule_template_empty: 'ยังไม่มีช่วงเวลาในตารางประจำสัปดาห์',
    schedule_template_entry_exists: 'มีช่วงเวลานี้อยู่แล้ว',
    schedule_weeks_title: 'เปิด/ปิดสัปดาห์',
    schedule_weeks_activate: 'เปิดจอง',
    schedule_weeks_deactivate: 'ปิดจอง',
    schedule_weeks_reapply: 'ใช้ตารางซ้ำ',
    schedule_weeks_activated_chip: 'เปิดจองแล้ว',
    schedule_bulk_title: 'เปิดจองล่วงหน้าหลายสัปดาห์',
    schedule_bulk_weeks_label: 'จำนวนสัปดาห์',
    schedule_bulk_btn: 'เปิดจองทั้งหมด',

    // Admin — calendar / bookings
    calendar_legend_free: 'ว่าง', calendar_legend_booked: 'จองแล้ว', calendar_legend_blocked: 'ปิดรับ',
    calendar_count_free: 'ว่าง {n}', calendar_count_booked: 'จอง {n}', calendar_count_blocked: 'ปิด {n}',
    day_panel_title: 'รายละเอียดวันที่ {date}',
    day_panel_empty: 'วันนี้ไม่มีคิวเลย',
    day_panel_add_slot: 'เพิ่มช่วงเวลานอกตาราง',
    day_panel_add_slot_time: 'เวลา',
    day_panel_add_slot_blocked: 'ปิดรับทันที',
    day_panel_slot_free: 'ว่าง',
    day_panel_slot_blocked: 'ปิดรับ',
    day_panel_slot_book: 'จองให้นักเรียน',
    day_panel_slot_block: 'ปิดรับ',
    day_panel_slot_unblock: 'เปิดรับ',
    day_panel_slot_delete: 'ลบช่วงเวลานี้',
    day_panel_slot_delete_confirm: 'ลบช่วงเวลานี้ใช่หรือไม่?',
    day_panel_slot_booked_by: 'จองโดย {name}',
    day_panel_booking_edit: 'แก้ไขข้อมูล',
    day_panel_booking_move: 'ย้ายเวลา',
    day_panel_booking_cancel: 'ยกเลิกการจอง',
    day_panel_booking_cancel_confirm: 'ยกเลิกการจองของ {name} ใช่หรือไม่?',
    booking_form_title_new: 'จองเวลาให้นักเรียน',
    booking_form_title_edit: 'แก้ไขข้อมูลนักเรียน',
    move_modal_title: 'ย้ายไปเวลาไหน?',
    move_modal_none: 'ไม่มีช่วงเวลาว่างอื่นในวันนี้',
    move_modal_conflict: 'ย้ายไม่สำเร็จ เวลานั้นชนกับการจองอื่น',
    booking_conflict: 'ช่วงเวลานี้ไม่ว่างแล้ว',

    // Admin — notifications
    notif_empty: 'ยังไม่มีการแจ้งเตือน',
    notif_new_booking: '{name} จองเวลา {time}',
    notif_new_cancel: '{name} ยกเลิกเวลา {time}',
    notif_go_to_day: 'ไปที่วันนี้',

    // Admin — log
    log_filter_type: 'ประเภท', log_filter_actor: 'ผู้ทำรายการ', log_filter_month: 'เดือน',
    log_type_all: 'ทั้งหมด',
    log_type_booked: 'จองใหม่', log_type_moved: 'ย้ายเวลา', log_type_cancelled: 'ยกเลิก', log_type_edited: 'แก้ไข',
    log_actor_all: 'ทั้งหมด',
    log_actor_booker: 'นักเรียน', log_actor_admin: 'ครู',
    log_order_toggle_newest: 'ใหม่ก่อน', log_order_toggle_oldest: 'เก่าก่อน',
    log_empty: 'ไม่พบรายการ',
    log_move_arrow: '{before} → {after}',
    log_month_note: 'กรองตามวันที่ทำรายการ ไม่ใช่วันที่เรียน',

    // Admin — settings
    settings_display_name: 'ชื่อครูผู้สอน',
    settings_slug_title: 'ลิงก์หน้าจอง',
    settings_slug_current: 'ลิงก์ปัจจุบัน',
    settings_slug_custom: 'ตั้งลิงก์เอง',
    settings_slug_custom_hint: 'ตัวอักษรพิมพ์เล็ก ตัวเลข และ - เท่านั้น (3-32 ตัวอักษร)',
    settings_slug_save: 'บันทึกลิงก์',
    settings_slug_regenerate: 'สุ่มลิงก์ใหม่',
    settings_slug_taken: 'ลิงก์นี้มีผู้ใช้แล้ว',
    settings_slug_invalid: 'รูปแบบลิงก์ไม่ถูกต้อง',
    settings_slug_confirm_title: 'ยืนยันการเปลี่ยนลิงก์',
    settings_slug_confirm_body: 'ลิงก์เดิมจะใช้งานไม่ได้ทันที หากเคยแชร์ลิงก์เดิมไว้ที่ไลน์หรือที่อื่น นักเรียนจะเข้าไม่ได้อีก ต้องการดำเนินการต่อหรือไม่?',
    settings_share_copy: 'คัดลอกลิงก์',

    // Owner
    owner_title: 'จัดการบัญชีครู',
    owner_admins_empty: 'ยังไม่มีบัญชีครู',
    owner_admin_create_title: 'เพิ่มบัญชีครูใหม่',
    owner_admin_username: 'ชื่อผู้ใช้',
    owner_admin_password: 'รหัสผ่าน',
    owner_admin_display_name: 'ชื่อครู',
    owner_admin_create_btn: 'สร้างบัญชี',
    owner_admin_username_taken: 'ชื่อผู้ใช้นี้มีผู้ใช้แล้ว',
    owner_admin_edit_title: 'แก้ไขบัญชี {name}',
    owner_admin_new_password: 'รหัสผ่านใหม่ (ไม่บังคับ)',
    owner_admin_delete_confirm: 'ลบบัญชีของ {name} ใช่หรือไม่? ข้อมูลตาราง การจอง และประวัติทั้งหมดจะถูกลบถาวร',
    owner_admin_slug_label: 'ลิงก์',

    error_invalid_request: 'ข้อมูลไม่ถูกต้อง',
    error_unauthorized: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
    error_not_found: 'ไม่พบข้อมูล',
    error_rate_limited: 'ทำรายการถี่เกินไป กรุณารอสักครู่',
  },

  en: {
    app_name: 'Suvida Piano Studio',
    lang_toggle_th: 'TH',
    lang_toggle_en: 'EN',

    nav_schedule: 'Schedule',
    nav_calendar: 'Calendar',
    nav_notifications: 'Notifications',
    nav_log: 'Log',
    nav_settings: 'Settings',
    nav_logout: 'Log out',
    nav_admins: 'Teachers',

    weekday_short_0: 'Sun', weekday_short_1: 'Mon', weekday_short_2: 'Tue', weekday_short_3: 'Wed',
    weekday_short_4: 'Thu', weekday_short_5: 'Fri', weekday_short_6: 'Sat',
    weekday_full_0: 'Sunday', weekday_full_1: 'Monday', weekday_full_2: 'Tuesday', weekday_full_3: 'Wednesday',
    weekday_full_4: 'Thursday', weekday_full_5: 'Friday', weekday_full_6: 'Saturday',

    month_1: 'January', month_2: 'February', month_3: 'March', month_4: 'April',
    month_5: 'May', month_6: 'June', month_7: 'July', month_8: 'August',
    month_9: 'September', month_10: 'October', month_11: 'November', month_12: 'December',

    calendar_prev: 'Previous month',
    calendar_next: 'Next month',
    calendar_today: 'Today',

    common_loading: 'Loading…',
    common_error_generic: 'Something went wrong. Please try again.',
    common_error_network: 'Could not connect. Check your internet and try again.',
    common_save: 'Save',
    common_cancel: 'Cancel',
    common_close: 'Close',
    common_confirm: 'Confirm',
    common_delete: 'Delete',
    common_edit: 'Edit',
    common_add: 'Add',
    common_back: 'Back',
    common_copy: 'Copy',
    common_copied: 'Copied',
    common_none: 'None',
    common_optional: 'optional',
    common_load_more: 'Load more',
    common_retry: 'Retry',

    booker_tab_book: 'Book a lesson',
    booker_tab_history: 'My bookings',
    booker_pick_day: 'Pick a day for your lesson',
    booker_no_slots_month: 'No open slots this month',
    booker_day_slots_title: 'Open times on {date}',
    booker_no_slots_day: 'No open slots left today',
    booker_slots_count: '{count} open',
    booker_day_none: 'No slots',
    booker_slot_book_btn: 'Book this time',
    booker_form_title: 'Confirm your details',
    booker_form_slot_label: 'Selected time',
    booker_form_name: 'Student name',
    booker_form_phone: 'Phone number',
    booker_form_submit: 'Confirm booking',
    booker_form_name_required: 'Please enter a name',
    booker_form_phone_required: 'Please enter a phone number',
    booker_book_success_title: 'Booked!',
    booker_book_success_body: 'Your lesson is confirmed. It has been saved on this device — check the "My bookings" tab any time.',
    booker_book_conflict: 'Sorry, that time was just taken. Please pick another.',
    booker_book_rate_limited: 'Too many attempts. Please wait a moment and try again.',
    booker_teacher_not_found: "This booking page couldn't be found. The link may be wrong or has changed.",
    booker_history_local_title: 'Booked from this device',
    booker_history_none_local: 'No bookings from this device yet',
    booker_history_lookup_title: 'Look up by phone number',
    booker_history_lookup_phone: 'Phone number',
    booker_history_lookup_btn: 'Search',
    booker_history_lookup_none: 'No active bookings found for that number',
    booker_history_cancel_btn: 'Cancel booking',
    booker_history_cancel_locked: 'Too late to cancel (under 24h)',
    booker_history_cancel_confirm: 'Cancel this lesson?',
    booker_history_cancel_success: 'Booking cancelled',
    booker_history_cancel_failed: 'Could not cancel — please check your details',
    booker_history_rate_limited: 'Too many attempts. Please wait a moment and try again.',

    login_title: 'Log in',
    login_username: 'Username',
    login_password: 'Password',
    login_remember: 'Remember login',
    login_submit: 'Log in',
    login_invalid: 'Incorrect username or password',
    login_rate_limited: 'Too many login attempts. Please wait a moment.',

    schedule_no_activation_banner: 'No upcoming week is open for booking — students will see no availability at all.',
    schedule_template_title: 'Weekly schedule template',
    schedule_template_hint: 'Editing this template does not retroactively change already-activated weeks — use "Re-apply template" on a week to update it.',
    schedule_template_add_weekday: 'Day',
    schedule_template_add_time: 'Start time',
    schedule_template_add_btn: 'Add time slot',
    schedule_template_empty: 'No time slots in the weekly template yet',
    schedule_template_entry_exists: 'That time slot already exists',
    schedule_weeks_title: 'Activate / deactivate weeks',
    schedule_weeks_activate: 'Activate',
    schedule_weeks_deactivate: 'Deactivate',
    schedule_weeks_reapply: 'Re-apply template',
    schedule_weeks_activated_chip: 'Active',
    schedule_bulk_title: 'Activate several weeks ahead',
    schedule_bulk_weeks_label: 'Number of weeks',
    schedule_bulk_btn: 'Activate all',

    calendar_legend_free: 'Free', calendar_legend_booked: 'Booked', calendar_legend_blocked: 'Blocked',
    calendar_count_free: '{n} free', calendar_count_booked: '{n} booked', calendar_count_blocked: '{n} blocked',
    day_panel_title: 'Details for {date}',
    day_panel_empty: 'No slots on this day',
    day_panel_add_slot: 'Add slot outside template',
    day_panel_add_slot_time: 'Time',
    day_panel_add_slot_blocked: 'Block immediately',
    day_panel_slot_free: 'Free',
    day_panel_slot_blocked: 'Blocked',
    day_panel_slot_book: 'Book for a student',
    day_panel_slot_block: 'Block',
    day_panel_slot_unblock: 'Unblock',
    day_panel_slot_delete: 'Remove this slot',
    day_panel_slot_delete_confirm: 'Remove this slot?',
    day_panel_slot_booked_by: 'Booked by {name}',
    day_panel_booking_edit: 'Edit details',
    day_panel_booking_move: 'Move time',
    day_panel_booking_cancel: 'Cancel booking',
    day_panel_booking_cancel_confirm: "Cancel {name}'s booking?",
    booking_form_title_new: 'Book for a student',
    booking_form_title_edit: "Edit student's details",
    move_modal_title: 'Move to which time?',
    move_modal_none: 'No other free slots today',
    move_modal_conflict: 'Could not move — that time conflicts with another booking',
    booking_conflict: 'That slot is no longer available',

    notif_empty: 'No notifications yet',
    notif_new_booking: '{name} booked {time}',
    notif_new_cancel: '{name} cancelled {time}',
    notif_go_to_day: 'Go to this day',

    log_filter_type: 'Type', log_filter_actor: 'Actor', log_filter_month: 'Month',
    log_type_all: 'All',
    log_type_booked: 'Booked', log_type_moved: 'Moved', log_type_cancelled: 'Cancelled', log_type_edited: 'Edited',
    log_actor_all: 'All',
    log_actor_booker: 'Student', log_actor_admin: 'Teacher',
    log_order_toggle_newest: 'Newest first', log_order_toggle_oldest: 'Oldest first',
    log_empty: 'No events found',
    log_move_arrow: '{before} → {after}',
    log_month_note: 'Filters by when the action happened, not the lesson date.',

    settings_display_name: 'Teacher name',
    settings_slug_title: 'Booking page link',
    settings_slug_current: 'Current link',
    settings_slug_custom: 'Set a custom link',
    settings_slug_custom_hint: 'Lowercase letters, numbers, and - only (3–32 characters)',
    settings_slug_save: 'Save link',
    settings_slug_regenerate: 'Generate random link',
    settings_slug_taken: 'That link is already taken',
    settings_slug_invalid: 'Invalid link format',
    settings_slug_confirm_title: 'Confirm link change',
    settings_slug_confirm_body: "The old link will stop working immediately. If you've shared it on LINE or elsewhere, students won't be able to reach it anymore. Continue?",
    settings_share_copy: 'Copy link',

    owner_title: 'Manage teacher accounts',
    owner_admins_empty: 'No teacher accounts yet',
    owner_admin_create_title: 'Add a new teacher account',
    owner_admin_username: 'Username',
    owner_admin_password: 'Password',
    owner_admin_display_name: 'Teacher name',
    owner_admin_create_btn: 'Create account',
    owner_admin_username_taken: 'That username is already taken',
    owner_admin_edit_title: 'Edit {name}',
    owner_admin_new_password: 'New password (optional)',
    owner_admin_delete_confirm: "Delete {name}'s account? All schedules, bookings, and history will be permanently removed.",
    owner_admin_slug_label: 'Link',

    error_invalid_request: 'Invalid request',
    error_unauthorized: 'Please log in again',
    error_not_found: 'Not found',
    error_rate_limited: 'Too many attempts. Please wait a moment.',
  },
};

const I18N = {
  lang: localStorage.getItem(I18N_STORAGE_KEY) || 'th',

  t(key, vars) {
    const dict = DICT[I18N.lang] || DICT.th;
    let str = dict[key] ?? DICT.th[key] ?? key;
    if (vars) {
      for (const k in vars) str = str.replace(`{${k}}`, vars[k]);
    }
    return str;
  },

  setLang(lang) {
    if (lang !== 'th' && lang !== 'en') return;
    I18N.lang = lang;
    localStorage.setItem(I18N_STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    I18N.apply();
    document.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang } }));
  },

  apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = I18N.t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = I18N.t(el.getAttribute('data-i18n-placeholder'));
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', I18N.t(el.getAttribute('data-i18n-aria-label')));
    });
  },

  weekdayShort(idx) { return I18N.t(`weekday_short_${idx}`); },
  weekdayFull(idx) { return I18N.t(`weekday_full_${idx}`); },
  monthName(m) { return I18N.t(`month_${m}`); },
};

document.documentElement.lang = I18N.lang;

// Mounts a TH/EN toggle control into `container` (a DOM node); call after
// the shell markup exists.
function mountLangToggle(container) {
  const wrap = document.createElement('div');
  wrap.className = 'row';
  wrap.style.gap = '0';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Language');

  const thBtn = document.createElement('button');
  thBtn.type = 'button';
  thBtn.className = 'chip';
  thBtn.textContent = 'ไทย';

  const enBtn = document.createElement('button');
  enBtn.type = 'button';
  enBtn.className = 'chip';
  enBtn.textContent = 'EN';

  function refresh() {
    thBtn.setAttribute('aria-pressed', String(I18N.lang === 'th'));
    enBtn.setAttribute('aria-pressed', String(I18N.lang === 'en'));
  }
  thBtn.addEventListener('click', () => { I18N.setLang('th'); refresh(); });
  enBtn.addEventListener('click', () => { I18N.setLang('en'); refresh(); });
  refresh();

  wrap.appendChild(thBtn);
  wrap.appendChild(enBtn);
  container.appendChild(wrap);
}
