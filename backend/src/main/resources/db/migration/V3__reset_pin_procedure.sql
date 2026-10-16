DELIMITER //
CREATE PROCEDURE reset_parent_pin(IN p_admin_name VARCHAR(100))
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  IF p_admin_name IS NULL OR TRIM(p_admin_name) = '' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'reset_parent_pin: admin name is required';
  END IF;
  START TRANSACTION;
    UPDATE family_settings
       SET pin_hash = NULL, pin_set_at = NULL,
           failed_pin_attempts = 0, lockout_level = 0, pin_locked_until = NULL,
           updated_at = UTC_TIMESTAMP(3)
     WHERE id = 1;
    DELETE FROM parent_session;
    INSERT INTO pin_reset_log (reset_at, admin_name, db_user)
    VALUES (UTC_TIMESTAMP(3), TRIM(p_admin_name), SESSION_USER());
  COMMIT;
END //
DELIMITER ;
