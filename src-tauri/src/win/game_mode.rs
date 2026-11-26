#[cfg(target_os = "windows")]
pub fn is_fullscreen_game_active() -> bool {
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN,
    };

    let Ok(state) = (unsafe { SHQueryUserNotificationState() }) else {
        return false;
    };
    state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_BUSY
}

#[cfg(not(target_os = "windows"))]
pub fn is_fullscreen_game_active() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_fullscreen_game_active_does_not_panic() {
        let _ = is_fullscreen_game_active();
    }
}
