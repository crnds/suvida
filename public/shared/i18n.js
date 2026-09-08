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
    a11y_skip_to_content: 'ข้ามไปยังเนื้อหาหลัก',
    a11y_sections: 'ส่วนต่าง ๆ',
    a11y_admin_sections: 'ส่วนต่าง ๆ สำหรับครู',
    a11y_legend: 'คำอธิบายสัญลักษณ์',
    a11y_language: 'ภาษา',
    a11y_menu: 'เมนู',
    a11y_menu_close: 'ปิดเมนู',
    title_admin: 'สำหรับครู — Suvida Piano Studio',
    title_owner: 'ผู้ดูแลระบบ — Suvida Piano Studio',

    // Booker page
    booker_tab_book: 'จองเวลาเรียน',
    booker_tab_history: 'ประวัติการจอง',
    booker_pick_day: 'เลือกวันที่ต้องการเรียน',
    booker_no_slots_month: 'เดือนนี้ยังไม่มีคิวว่าง',
    booker_no_slots_month_hint: 'ลองดูเดือนถัดไป หรือสอบถามครูผู้สอนโดยตรง',
    booker_day_slots_title: 'เวลาว่างวันที่ {date}',
    booker_no_slots_day: 'วันนี้ไม่มีคิวว่างแล้ว',
    booker_slots_count: 'ว่าง {count} คิว',
    booker_day_none: 'ไม่มีคิว',
    booker_form_title: 'กรอกข้อมูลเพื่อจอง',
    booker_form_slot_label: 'เวลาที่เลือก',
    booker_form_name: 'ชื่อผู้เรียน',
    booker_form_phone: 'เบอร์โทรศัพท์',
    booker_form_submit: 'ยืนยันการจอง',
    booker_form_name_required: 'กรุณากรอกชื่อ',
    booker_form_phone_required: 'กรุณากรอกเบอร์โทรศัพท์',
    booker_form_phone_invalid: 'เบอร์โทรศัพท์ไม่ถูกต้อง กรุณากรอกตัวเลข 9-15 หลัก',
    booker_form_phone_hint: 'ใช้เบอร์นี้สำหรับค้นหาและยกเลิกการจองภายหลัง',
    booker_form_check_fields: 'กรุณาตรวจสอบข้อมูลที่กรอก',
    booker_form_back: 'เลือกเวลาอื่น',
    booker_book_success_title: 'จองสำเร็จ',
    booker_book_success_body: 'บันทึกเวลาเรียนของคุณแล้ว',
    booker_book_success_cta: 'ดูประวัติการจอง',
    booker_book_rate_limited: 'มีการจองถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
    booker_teacher_not_found: 'ไม่พบหน้าจองนี้ ลิงก์อาจไม่ถูกต้องหรือถูกเปลี่ยนแล้ว',
    booker_history_local_title: 'การจองจากเครื่องนี้',
    booker_history_none_local: 'ยังไม่มีการจองจากเครื่องนี้',
    booker_history_lookup_title: 'ค้นหาด้วยเบอร์โทรศัพท์',
    booker_history_lookup_hint: 'จองจากเครื่องอื่นใช่ไหม? กรอกเบอร์ที่ใช้จองเพื่อดูและยกเลิกการจอง',
    booker_history_lookup_phone: 'เช่น 0812345678',
    booker_history_lookup_phone_label: 'เบอร์โทรศัพท์',
    booker_history_lookup_btn: 'ค้นหา',
    booker_history_lookup_none: 'ไม่พบการจองที่ใช้งานอยู่สำหรับเบอร์นี้',
    booker_history_lookup_found: 'พบการจอง {count} รายการ',
    booker_history_cancel_btn: 'ยกเลิกการจอง',
    booker_history_cancel_locked: 'ยกเลิกไม่ได้ (เหลือน้อยกว่า 24 ชม.)',
    booker_history_cancel_confirm: 'ยืนยันยกเลิกเวลาเรียนนี้ใช่หรือไม่?',
    booker_history_cancel_success: 'ยกเลิกการจองแล้ว',
    booker_history_rate_limited: 'ค้นหาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
    booker_location_filter_all: 'ทุกสถานที่',
    booker_location_filter_label: 'กรองตามสถานที่',

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
    schedule_template_add_location: 'สถานที่',
    schedule_template_add_btn: 'เพิ่มช่วงเวลา',
    schedule_template_empty: 'ยังไม่มีช่วงเวลาในตารางประจำสัปดาห์',
    schedule_template_entry_exists: 'มีช่วงเวลานี้อยู่แล้ว',
    schedule_template_added: 'เพิ่มช่วงเวลาแล้ว',
    schedule_template_removed: 'ลบช่วงเวลาแล้ว',
    schedule_bulk_done: 'เปิดจองล่วงหน้า {n} สัปดาห์แล้ว',
    schedule_template_no_locations_hint: 'เพิ่มสถานที่ในหน้าตั้งค่าก่อนสร้างตารางเวลา',
    schedule_weeks_title: 'เปิด/ปิดสัปดาห์',
    schedule_weeks_activate: 'เปิดจอง',
    schedule_weeks_deactivate: 'ปิดจอง',
    schedule_weeks_reapply: 'ใช้ตารางซ้ำ',
    schedule_weeks_activated_chip: 'เปิดจองแล้ว',
    schedule_bulk_weeks_label: 'จำนวนสัปดาห์',
    schedule_bulk_btn: 'เปิดจองทั้งหมด',

    // Admin — calendar / bookings
    calendar_legend_free: 'ว่าง', calendar_legend_booked: 'จองแล้ว', calendar_legend_blocked: 'ปิดรับ',
    calendar_count_free: 'ว่าง {n}', calendar_count_booked: 'จอง {n}', calendar_count_blocked: 'ปิด {n}',
    calendar_filter_all_locations: 'ทุกสถานที่',
    calendar_filter_location_label: 'กรองตามสถานที่',
    day_panel_title: 'รายละเอียดวันที่ {date}',
    day_panel_empty: 'วันนี้ไม่มีคิวเลย',
    day_panel_add_slot: 'เพิ่มช่วงเวลานอกตาราง',
    day_panel_add_slot_time: 'เวลา',
    day_panel_add_slot_location: 'สถานที่',
    day_panel_add_slot_blocked: 'ปิดรับทันที',
    day_panel_slot_free: 'ว่าง',
    day_panel_slot_blocked: 'ปิดรับ',
    day_panel_slot_book: 'จองให้นักเรียน',
    day_panel_slot_block: 'ปิดรับ',
    day_panel_slot_unblock: 'เปิดรับ',
    day_panel_slot_delete: 'ลบช่วงเวลานี้',
    day_panel_slot_delete_confirm: 'ลบช่วงเวลานี้ใช่หรือไม่?',
    day_panel_slot_added: 'เพิ่มช่วงเวลาแล้ว',
    day_panel_booking_cancelled: 'ยกเลิกการจองแล้ว',
    day_panel_booking_edit: 'แก้ไขข้อมูล',
    day_panel_booking_move: 'ย้ายเวลา',
    day_panel_booking_cancel: 'ยกเลิกการจอง',
    day_panel_booking_cancel_confirm: 'ยกเลิกการจองของ {name} ใช่หรือไม่?',
    booking_form_title_new: 'จองเวลาให้นักเรียน',
    booking_form_title_edit: 'แก้ไขข้อมูลนักเรียน',
    move_modal_title: 'ย้ายไปเวลาไหน?',
    move_modal_none: 'ไม่มีช่วงเวลาว่างอื่นในวันนี้',
    move_modal_conflict: 'ย้ายไม่สำเร็จ เวลานั้นชนกับการจองอื่น',
    move_modal_moved: 'ย้ายเวลาเรียนแล้ว',
    move_modal_hint: 'เลือกเวลาว่างในวันเดียวกันเพื่อย้ายการจองนี้',
    booking_conflict: 'ช่วงเวลานี้ไม่ว่างแล้ว',

    // Admin — notifications
    notif_empty: 'ยังไม่มีการแจ้งเตือน',
    notif_new_booking: '{name} จองเวลา {time}',
    notif_new_cancel: '{name} ยกเลิกเวลา {time}',
    notif_go_to_day: 'ไปที่วันนี้',
    notif_unread_count: 'แจ้งเตือนใหม่ {n} รายการ',

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
    settings_locations_title: 'สถานที่',
    settings_locations_hint: 'จัดการรายชื่อสถานที่สอนของคุณ',
    settings_locations_add_label: 'ชื่อสถานที่',
    settings_locations_add_btn: 'เพิ่มสถานที่',
    settings_locations_empty: 'ยังไม่มีสถานที่',
    settings_locations_in_use: 'ไม่สามารถลบได้ เนื่องจากมีตารางเวลาที่ใช้สถานที่นี้อยู่',
    settings_locations_added: 'เพิ่มสถานที่แล้ว',
    settings_locations_removed: 'ลบสถานที่แล้ว',
    settings_locations_delete_confirm: 'ลบสถานที่ "{name}" ใช่หรือไม่?',
    settings_share_copy_manual: 'คัดลอกอัตโนมัติไม่ได้ กรุณากด Ctrl/Cmd+C',
    settings_slug_saved: 'บันทึกลิงก์ใหม่แล้ว',
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
    settings_reset_title: 'รีเซ็ตการตั้งค่า',
    settings_reset_hint: 'ลบตารางเวลาและสถานที่ และสร้างลิงก์จองใหม่',
    settings_reset_btn: 'กลับค่าเดิม',
    settings_reset_confirm_title: 'รีเซ็ตการตั้งค่า?',
    settings_reset_confirm_body: 'ตารางเวลาและสถานที่จะถูกลบ และจะสร้างลิงก์จองใหม่ ลิงก์เดิมจะใช้งานไม่ได้ทันที การจองที่มีอยู่แล้วจะไม่ถูกลบ ต้องการดำเนินการต่อหรือไม่?',
    settings_reset_done: 'รีเซ็ตการตั้งค่าแล้ว',

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
    owner_admin_created: 'สร้างบัญชีของ {name} แล้ว',
    owner_admin_saved: 'บันทึกการแก้ไขแล้ว',
    owner_admin_deleted: 'ลบบัญชีแล้ว',
    owner_admin_password_hint: 'เว้นว่างไว้หากไม่ต้องการเปลี่ยนรหัสผ่าน',

    landing_body: 'นักเรียนจองผ่านลิงก์เฉพาะของครูแต่ละท่าน — กรุณาสอบถามลิงก์จากครูผู้สอนของคุณ',
    landing_teacher_login: 'เข้าสู่ระบบสำหรับครู',
    landing_owner_login: 'เข้าสู่ระบบสำหรับผู้ดูแล',

    error_invalid_request: 'ข้อมูลไม่ถูกต้อง',
    error_unauthorized: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
    error_not_found: 'ไม่พบข้อมูล',
    error_rate_limited: 'ทำรายการถี่เกินไป กรุณารอสักครู่',
    // The API has always returned these; nothing in the front-end mapped
    // them, so a taken slot and a wrong password both read "เกิดข้อผิดพลาด".
    error_slot_unavailable: 'ขออภัย เวลานี้เพิ่งถูกจองไปแล้ว กรุณาเลือกเวลาอื่น',
    error_cannot_cancel: 'ยกเลิกไม่ได้แล้ว (ต้องยกเลิกก่อนเรียนอย่างน้อย 24 ชั่วโมง)',
    error_invalid_credentials: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
    error_invalid_location: 'ไม่พบสถานที่ที่เลือก',
    error_location_in_use: 'ลบไม่ได้ เพราะยังมีตารางหรือคิวที่ใช้สถานที่นี้อยู่',
    error_slug_taken: 'ลิงก์นี้มีผู้ใช้แล้ว กรุณาเลือกใหม่',
    error_invalid_slug: 'ลิงก์ไม่ถูกต้อง ใช้ได้เฉพาะ a-z 0-9 และ - ความยาว 3-32 ตัวอักษร',
    error_slot_exists: 'มีช่วงเวลานี้อยู่แล้ว',
    error_slot_booked: 'ลบไม่ได้ เพราะมีคิวจองอยู่ กรุณายกเลิกคิวก่อน',
    error_move_unavailable: 'ย้ายไม่ได้ เพราะเวลานั้นไม่ว่างแล้ว',
    error_booking_cancelled: 'คิวนี้ถูกยกเลิกไปแล้ว',
    error_in_past: 'เวลานี้ผ่านไปแล้ว กรุณาเลือกเวลาในอนาคต',
    error_invalid_date: 'วันที่ไม่ถูกต้อง',
    error_entry_exists: 'มีรายการนี้ในตารางประจำสัปดาห์แล้ว',
    error_username_taken: 'ชื่อผู้ใช้นี้มีอยู่แล้ว',
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
    a11y_skip_to_content: 'Skip to main content',
    a11y_sections: 'Sections',
    a11y_admin_sections: 'Admin sections',
    a11y_legend: 'Legend',
    a11y_language: 'Language',
    a11y_menu: 'Menu',
    a11y_menu_close: 'Close menu',
    title_admin: 'Teacher — Suvida Piano Studio',
    title_owner: 'Owner — Suvida Piano Studio',

    booker_tab_book: 'Book a lesson',
    booker_tab_history: 'My bookings',
    booker_pick_day: 'Pick a day for your lesson',
    booker_no_slots_month: 'No open slots this month',
    booker_no_slots_month_hint: 'Try the next month, or ask your teacher directly.',
    booker_day_slots_title: 'Open times on {date}',
    booker_no_slots_day: 'No open slots left today',
    booker_slots_count: '{count} open',
    booker_day_none: 'No slots',
    booker_form_title: 'Confirm your details',
    booker_form_slot_label: 'Selected time',
    booker_form_name: 'Student name',
    booker_form_phone: 'Phone number',
    booker_form_submit: 'Confirm booking',
    booker_form_name_required: 'Please enter a name',
    booker_form_phone_required: 'Please enter a phone number',
    booker_form_phone_invalid: "That doesn't look like a phone number — please enter 9-15 digits",
    booker_form_phone_hint: "You'll use this number to find or cancel the booking later",
    booker_form_check_fields: 'Please check the highlighted fields',
    booker_form_back: 'Pick a different time',
    booker_book_success_title: 'Booked!',
    booker_book_success_body: 'Your lesson is confirmed.',
    booker_book_success_cta: 'View my bookings',
    booker_book_rate_limited: 'Too many attempts. Please wait a moment and try again.',
    booker_teacher_not_found: "This booking page couldn't be found. The link may be wrong or has changed.",
    booker_history_local_title: 'Booked from this device',
    booker_history_none_local: 'No bookings from this device yet',
    booker_history_lookup_title: 'Look up by phone number',
    booker_history_lookup_hint: 'Booked on another device? Enter the number you booked with to view or cancel it.',
    booker_history_lookup_phone: 'e.g. 0812345678',
    booker_history_lookup_phone_label: 'Phone number',
    booker_history_lookup_btn: 'Search',
    booker_history_lookup_none: 'No active bookings found for that number',
    booker_history_lookup_found: '{count} booking(s) found',
    booker_history_cancel_btn: 'Cancel booking',
    booker_history_cancel_locked: 'Too late to cancel (under 24h)',
    booker_history_cancel_confirm: 'Cancel this lesson?',
    booker_history_cancel_success: 'Booking cancelled',
    booker_history_rate_limited: 'Too many attempts. Please wait a moment and try again.',
    booker_location_filter_all: 'All locations',
    booker_location_filter_label: 'Filter by location',

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
    schedule_template_add_location: 'Location',
    schedule_template_add_btn: 'Add time slot',
    schedule_template_empty: 'No time slots in the weekly template yet',
    schedule_template_entry_exists: 'That time slot already exists',
    schedule_template_added: 'Time slot added',
    schedule_template_removed: 'Time slot removed',
    schedule_bulk_done: 'Opened booking for the next {n} week(s)',
    schedule_template_no_locations_hint: 'Add a location in Settings before creating a schedule entry.',
    schedule_weeks_title: 'Activate / deactivate weeks',
    schedule_weeks_activate: 'Activate',
    schedule_weeks_deactivate: 'Deactivate',
    schedule_weeks_reapply: 'Re-apply template',
    schedule_weeks_activated_chip: 'Active',
    schedule_bulk_weeks_label: 'Number of weeks',
    schedule_bulk_btn: 'Activate all',

    calendar_legend_free: 'Free', calendar_legend_booked: 'Booked', calendar_legend_blocked: 'Blocked',
    calendar_count_free: '{n} free', calendar_count_booked: '{n} booked', calendar_count_blocked: '{n} blocked',
    calendar_filter_all_locations: 'All locations',
    calendar_filter_location_label: 'Filter by location',
    day_panel_title: 'Details for {date}',
    day_panel_empty: 'No slots on this day',
    day_panel_add_slot: 'Add slot outside template',
    day_panel_add_slot_time: 'Time',
    day_panel_add_slot_location: 'Location',
    day_panel_add_slot_blocked: 'Block immediately',
    day_panel_slot_free: 'Free',
    day_panel_slot_blocked: 'Blocked',
    day_panel_slot_book: 'Book for a student',
    day_panel_slot_block: 'Block',
    day_panel_slot_unblock: 'Unblock',
    day_panel_slot_delete: 'Remove this slot',
    day_panel_slot_delete_confirm: 'Remove this slot?',
    day_panel_slot_added: 'Slot added',
    day_panel_booking_cancelled: 'Booking cancelled',
    day_panel_booking_edit: 'Edit details',
    day_panel_booking_move: 'Move time',
    day_panel_booking_cancel: 'Cancel booking',
    day_panel_booking_cancel_confirm: "Cancel {name}'s booking?",
    booking_form_title_new: 'Book for a student',
    booking_form_title_edit: "Edit student's details",
    move_modal_title: 'Move to which time?',
    move_modal_none: 'No other free slots today',
    move_modal_conflict: 'Could not move — that time conflicts with another booking',
    move_modal_moved: 'Lesson moved',
    move_modal_hint: 'Pick an open time on the same day to move this booking to.',
    booking_conflict: 'That slot is no longer available',

    notif_empty: 'No notifications yet',
    notif_new_booking: '{name} booked {time}',
    notif_new_cancel: '{name} cancelled {time}',
    notif_go_to_day: 'Go to this day',
    notif_unread_count: '{n} unread notification(s)',

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
    settings_locations_title: 'Locations',
    settings_locations_hint: 'Manage the studio locations you teach at.',
    settings_locations_add_label: 'Location name',
    settings_locations_add_btn: 'Add location',
    settings_locations_empty: 'No locations yet.',
    settings_locations_in_use: "Can't delete — this location is still in use by a template or slot.",
    settings_locations_added: 'Location added',
    settings_locations_removed: 'Location removed',
    settings_locations_delete_confirm: 'Delete the location "{name}"?',
    settings_share_copy_manual: "Couldn't copy automatically — press Ctrl/Cmd+C",
    settings_slug_saved: 'New link saved',
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
    settings_reset_title: 'Reset settings',
    settings_reset_hint: 'Clears the schedule template and all locations, and issues a fresh booking link.',
    settings_reset_btn: 'Reset to default',
    settings_reset_confirm_title: 'Reset all settings?',
    settings_reset_confirm_body: 'This clears your schedule template, removes all locations (restoring the default one), and issues a fresh booking link — the old link stops working. Existing bookings are kept. Continue?',
    settings_reset_done: 'Settings reset to default',

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
    owner_admin_created: "Created {name}'s account",
    owner_admin_saved: 'Changes saved',
    owner_admin_deleted: 'Account deleted',
    owner_admin_password_hint: 'Leave blank to keep the current password',

    landing_body: "Students book through their teacher's own link — ask your teacher for theirs.",
    landing_teacher_login: 'Teacher login',
    landing_owner_login: 'Owner login',

    error_invalid_request: 'Invalid request',
    error_unauthorized: 'Please log in again',
    error_not_found: 'Not found',
    error_rate_limited: 'Too many attempts. Please wait a moment.',
    error_slot_unavailable: 'Sorry — that time was just booked. Please choose another.',
    error_cannot_cancel: 'This booking can no longer be cancelled (cancellations close 24 hours before the lesson).',
    error_invalid_credentials: 'Incorrect username or password',
    error_invalid_location: 'That location could not be found',
    error_location_in_use: 'This location is still used by a schedule or booking, so it cannot be deleted.',
    error_slug_taken: 'That link is already taken. Please choose another.',
    error_invalid_slug: 'Links can use a-z, 0-9 and - only, 3-32 characters.',
    error_slot_exists: 'That time already exists.',
    error_slot_booked: 'This time has a booking, so it cannot be deleted. Cancel the booking first.',
    error_move_unavailable: 'That time is no longer free, so the lesson could not be moved.',
    error_booking_cancelled: 'This booking has already been cancelled.',
    error_in_past: 'That time has already passed. Please choose a future time.',
    error_invalid_date: 'That date is not valid.',
    error_entry_exists: 'That time is already in the weekly schedule.',
    error_username_taken: 'That username is already taken.',
  },
};

// localStorage throws SecurityError in a sandboxed iframe or with site data
// blocked. This module is loaded before every app script, so an unguarded
// access here killed i18n.js at parse time and took every page on the site
// with it (format.js, ui.js and all three app scripts depend on I18N).
function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Non-fatal: the language just won't persist across reloads.
  }
}

const I18N = {
  lang: storageGet(I18N_STORAGE_KEY) || 'th',

  t(key, vars) {
    const dict = DICT[I18N.lang] || DICT.th;
    let str = dict[key] ?? DICT.th[key] ?? key;
    if (vars) {
      // Function replacement, not a string one. String.replace interprets
      // `$&`, `` $` ``, `$'` and `$1` in the *replacement*, so a student named
      // `$&` turned "{name} booked {time}" into "{name} booked 10:00", and a
      // location titled `$'` made the delete confirmation stop naming what it
      // was about to delete. Every interpolated key carries user data.
      for (const k in vars) {
        const value = vars[k];
        str = str.split(`{${k}}`).join(String(value ?? ''));
      }
    }
    return str;
  },

  setLang(lang) {
    if (lang !== 'th' && lang !== 'en') return;
    I18N.lang = lang;
    storageSet(I18N_STORAGE_KEY, lang);
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
    // The document title was hardcoded English on all four pages and there
    // was no mechanism to translate it. Pages that set their own title from
    // data (the booker uses the teacher's name) simply omit the attribute.
    const titleEl = document.querySelector('title[data-i18n]');
    if (titleEl) titleEl.textContent = I18N.t(titleEl.getAttribute('data-i18n'));
  },

  weekdayShort(idx) { return I18N.t(`weekday_short_${idx}`); },
  weekdayFull(idx) { return I18N.t(`weekday_full_${idx}`); },
  monthName(m) { return I18N.t(`month_${m}`); },
};

document.documentElement.lang = I18N.lang;

// Mounts a TH/EN toggle control into `container` (a DOM node); call after
// the shell markup exists.
function mountLangToggle(container) {
  // .chip-group collapses the two chips into one segmented control (a single
  // shared outline) instead of two adjacent boxes forced together by a
  // zero gap set from JS.
  const wrap = document.createElement('div');
  wrap.className = 'chip-group';
  wrap.setAttribute('role', 'group');
  // Was hardcoded English, so a Thai screen-reader user heard "Language".
  wrap.setAttribute('aria-label', I18N.t('a11y_language'));

  const thBtn = document.createElement('button');
  thBtn.type = 'button';
  thBtn.className = 'chip';
  thBtn.textContent = DICT.th.lang_toggle_th;

  const enBtn = document.createElement('button');
  enBtn.type = 'button';
  enBtn.className = 'chip';
  enBtn.textContent = DICT.en.lang_toggle_en;

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
