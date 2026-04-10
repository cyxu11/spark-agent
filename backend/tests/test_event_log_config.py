from deerflow.config.event_log_config import EventLogConfig, get_event_log_config, set_event_log_config


def test_default_disabled():
    cfg = EventLogConfig(connection_string="postgresql://localhost/test")
    assert cfg.enabled is False


def test_get_returns_none_by_default():
    set_event_log_config(None)
    assert get_event_log_config() is None


def test_set_and_get():
    cfg = EventLogConfig(enabled=True, connection_string="postgresql://localhost/test")
    set_event_log_config(cfg)
    assert get_event_log_config() is cfg
    set_event_log_config(None)  # cleanup
