use chrono::{Duration, SecondsFormat, Utc};
use rusqlite::types::Value;

use crate::error::{AppError, AppResult};
use crate::models::{SmartField, SmartMatch, SmartOp, SmartRuleCondition, SmartRules};

pub fn build_smart_rules_clause(
    rules: &SmartRules,
    start_param_index: usize,
) -> AppResult<(String, Vec<Value>)> {
    if rules.conditions.is_empty() {
        return Ok(("1 = 0".to_string(), Vec::new()));
    }

    let mut clauses = Vec::with_capacity(rules.conditions.len());
    let mut params = Vec::new();
    let mut next_idx = start_param_index;

    for cond in &rules.conditions {
        let sql = build_condition_clause(cond, &mut next_idx, &mut params)?;
        clauses.push(sql);
    }

    let joiner = match rules.match_mode {
        SmartMatch::All => " AND ",
        SmartMatch::Any => " OR ",
    };

    Ok((format!("({})", clauses.join(joiner)), params))
}

fn build_condition_clause(
    cond: &SmartRuleCondition,
    next_idx: &mut usize,
    params: &mut Vec<Value>,
) -> AppResult<String> {
    match cond.field {
        SmartField::Game => {
            let text = as_required_string(&cond.value, "game")?;
            let p = push_param(next_idx, params, Value::Text(match cond.op {
                SmartOp::Contains | SmartOp::Includes => format!("%{}%", escape_like(&text)),
                _ => text,
            }));
            match cond.op {
                SmartOp::Equals => Ok(format!(
                    "(LOWER(COALESCE(g.display_name, '')) = LOWER({p}) OR LOWER(COALESCE(g.raw_name, '')) = LOWER({p}))"
                )),
                SmartOp::NotEquals => Ok(format!(
                    "(LOWER(COALESCE(g.display_name, '')) != LOWER({p}) AND LOWER(COALESCE(g.raw_name, '')) != LOWER({p}))"
                )),
                SmartOp::Contains | SmartOp::Includes => Ok(format!(
                    "(LOWER(COALESCE(g.display_name, '')) LIKE LOWER({p}) ESCAPE '\\' OR LOWER(COALESCE(g.raw_name, '')) LIKE LOWER({p}) ESCAPE '\\')"
                )),
                _ => Err(AppError::InvalidInput(
                    "Unsupported operator for field 'game'".to_string(),
                )),
            }
        }
        SmartField::Tag => {
            let text = as_required_string(&cond.value, "tag")?;
            let p = push_param(next_idx, params, Value::Text(match cond.op {
                SmartOp::Contains => format!("%{}%", escape_like(&text)),
                _ => text,
            }));
            match cond.op {
                SmartOp::Equals | SmartOp::Includes => Ok(format!(
                    "EXISTS (SELECT 1 FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = c.id AND LOWER(t.name) = LOWER({p}))"
                )),
                SmartOp::NotEquals => Ok(format!(
                    "NOT EXISTS (SELECT 1 FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = c.id AND LOWER(t.name) = LOWER({p}))"
                )),
                SmartOp::Contains => Ok(format!(
                    "EXISTS (SELECT 1 FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = c.id AND LOWER(t.name) LIKE LOWER({p}) ESCAPE '\\')"
                )),
                _ => Err(AppError::InvalidInput(
                    "Unsupported operator for field 'tag'".to_string(),
                )),
            }
        }
        SmartField::TitleOrFilename => {
            let text = as_required_string(&cond.value, "title_or_filename")?;
            let p = push_param(next_idx, params, Value::Text(match cond.op {
                SmartOp::Contains | SmartOp::Includes => format!("%{}%", escape_like(&text)),
                _ => text,
            }));
            match cond.op {
                SmartOp::Equals => Ok(format!(
                    "(LOWER(COALESCE(c.title, '')) = LOWER({p}) OR LOWER(c.file_name) = LOWER({p}))"
                )),
                SmartOp::NotEquals => Ok(format!(
                    "(LOWER(COALESCE(c.title, '')) != LOWER({p}) AND LOWER(c.file_name) != LOWER({p}))"
                )),
                SmartOp::Contains | SmartOp::Includes => Ok(format!(
                    "(LOWER(COALESCE(c.title, '')) LIKE LOWER({p}) ESCAPE '\\' OR LOWER(c.file_name) LIKE LOWER({p}) ESCAPE '\\')"
                )),
                _ => Err(AppError::InvalidInput(
                    "Unsupported operator for field 'title_or_filename'".to_string(),
                )),
            }
        }
        SmartField::DurationSec => {
            let num = as_required_f64(&cond.value, "duration_sec")?;
            let p = push_param(next_idx, params, Value::Real(num));
            match cond.op {
                SmartOp::Lte => Ok(format!("c.duration_sec <= {p}")),
                SmartOp::Gte => Ok(format!("c.duration_sec >= {p}")),
                SmartOp::Equals => Ok(format!("ABS(c.duration_sec - {p}) < 0.001")),
                SmartOp::NotEquals => Ok(format!("ABS(c.duration_sec - {p}) >= 0.001")),
                _ => Err(AppError::InvalidInput(
                    "Unsupported operator for field 'duration_sec'".to_string(),
                )),
            }
        }
        SmartField::IsFavorite => {
            let b = as_required_bool(&cond.value, "is_favorite")?;
            let p = push_param(next_idx, params, Value::Integer(if b { 1 } else { 0 }));
            match cond.op {
                SmartOp::Equals => Ok(format!("c.is_favorite = {p}")),
                SmartOp::NotEquals => Ok(format!("c.is_favorite != {p}")),
                _ => Err(AppError::InvalidInput(
                    "Unsupported operator for field 'is_favorite'".to_string(),
                )),
            }
        }
        SmartField::RecordedWithinDays => {
            let days = as_required_f64(&cond.value, "recorded_within_days")?;
            if days < 0.0 {
                return Err(AppError::InvalidInput(
                    "recorded_within_days must be non-negative".to_string(),
                ));
            }
            let secs = (days * 86_400.0).round() as i64;
            let cutoff = (Utc::now() - Duration::seconds(secs))
                .to_rfc3339_opts(SecondsFormat::Secs, true);
            let p = push_param(next_idx, params, Value::Text(cutoff));
            match cond.op {
                SmartOp::Lte | SmartOp::Equals | SmartOp::Includes => {
                    Ok(format!("c.recorded_at >= {p}"))
                }
                SmartOp::Gte | SmartOp::NotEquals => Ok(format!("c.recorded_at < {p}")),
                _ => Err(AppError::InvalidInput(
                    "Unsupported operator for field 'recorded_within_days'".to_string(),
                )),
            }
        }
    }
}

fn push_param(next_idx: &mut usize, params: &mut Vec<Value>, value: Value) -> String {
    let idx = *next_idx;
    *next_idx += 1;
    params.push(value);
    format!("?{idx}")
}

fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn as_required_string(val: &serde_json::Value, field: &str) -> AppResult<String> {
    match val {
        serde_json::Value::String(s) => Ok(s.trim().to_string()),
        _ => Err(AppError::InvalidInput(format!(
            "Field '{field}' expects a string value"
        ))),
    }
}

fn as_required_f64(val: &serde_json::Value, field: &str) -> AppResult<f64> {
    match val {
        serde_json::Value::Number(n) => n
            .as_f64()
            .ok_or_else(|| AppError::InvalidInput(format!("Invalid number for '{field}'"))),
        serde_json::Value::String(s) => s
            .trim()
            .parse::<f64>()
            .map_err(|_| AppError::InvalidInput(format!("Invalid number for '{field}'"))),
        _ => Err(AppError::InvalidInput(format!(
            "Field '{field}' expects a numeric value"
        ))),
    }
}

fn as_required_bool(val: &serde_json::Value, field: &str) -> AppResult<bool> {
    match val {
        serde_json::Value::Bool(b) => Ok(*b),
        serde_json::Value::Number(n) => Ok(n.as_i64().unwrap_or(0) != 0),
        serde_json::Value::String(s) => match s.trim().to_ascii_lowercase().as_str() {
            "true" | "1" => Ok(true),
            "false" | "0" => Ok(false),
            _ => Err(AppError::InvalidInput(format!(
                "Field '{field}' expects a boolean value"
            ))),
        },
        _ => Err(AppError::InvalidInput(format!(
            "Field '{field}' expects a boolean value"
        ))),
    }
}
