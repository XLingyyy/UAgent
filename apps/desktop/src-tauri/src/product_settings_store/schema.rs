use super::*;
pub const SETTINGS_SCHEMA_VERSION: i64 = 3;
pub(super) const V1:&[&str]=&[
    "CREATE TABLE product_settings_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version>0))",
    "INSERT INTO product_settings_schema VALUES(1,1)",
    "CREATE TABLE product_user_preferences(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>0),payload TEXT NOT NULL)",
];
pub(super) const V2:&[&str]=&[
    "CREATE TABLE product_provider_profiles(provider_id TEXT PRIMARY KEY,revision INTEGER NOT NULL CHECK(revision>0),payload TEXT NOT NULL)",
    "CREATE TABLE product_project_preferences(project_id TEXT PRIMARY KEY,revision INTEGER NOT NULL CHECK(revision>0),payload TEXT NOT NULL,FOREIGN KEY(project_id) REFERENCES projects(id))",
    "CREATE TABLE product_capability_evidence(provider_id TEXT NOT NULL,model_id TEXT NOT NULL,configuration_fingerprint TEXT NOT NULL,observed_at INTEGER NOT NULL CHECK(observed_at>=0),payload TEXT NOT NULL,PRIMARY KEY(provider_id,model_id),FOREIGN KEY(provider_id) REFERENCES product_provider_profiles(provider_id) ON DELETE CASCADE)",
];
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct V1Preferences {
    pub theme: Theme,
    pub locale: Locale,
}
pub(super) fn migrate(db: &Db) -> Result<()> {
    db.transaction(||{
        let exists=db.query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='product_settings_schema'",&[])?[0][0].int()?;
        if exists==0 {
            if db.query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('product_user_preferences','product_provider_profiles','product_project_preferences','product_capability_evidence','product_provider_versions')",&[])?[0][0].int()?!=0 {return Err(StoreError::corrupt());}
            for sql in V1 {db.execute(sql,&[])?;}
        }
        let rows=db.query("SELECT singleton,version FROM product_settings_schema",&[])?;
        if rows.len()!=1 || rows[0][0].int()?!=1 {return Err(StoreError::corrupt());}
        let mut version=rows[0][1].int()?;
        if version>SETTINGS_SCHEMA_VERSION {return Err(StoreError::new("newerSettingsSchema","settings require a newer UAgent; no migration or reset was performed"));}
        if version==1 {
            for sql in V2 {db.execute(sql,&[])?;}
            let prefs=db.query("SELECT revision,CASE WHEN length(CAST(payload AS BLOB))<=262144 THEN payload ELSE NULL END FROM product_user_preferences WHERE singleton=1",&[])?;
            if let Some(row)=prefs.first() {
                if row[0].int()?<1 {return Err(StoreError::corrupt());}
                let old:V1Preferences=decode(&row[1])?;
                let next=UserPreferences {theme:old.theme,locale:old.locale,..UserPreferences::default()};
                db.execute("UPDATE product_user_preferences SET payload=? WHERE singleton=1",&[encode(&next)?.into()])?;
            }
            version=2;
        }
        if version==2 {
            // Independent of the profile FK: deletion must never erase identity/version.
            db.execute("CREATE TABLE product_provider_versions(provider_id TEXT PRIMARY KEY,generation TEXT NOT NULL CHECK(length(generation)=64),revision INTEGER NOT NULL CHECK(revision>0),present INTEGER NOT NULL CHECK(present IN (0,1)))",&[])?;
            let profiles=db.query("SELECT provider_id,revision FROM product_provider_profiles ORDER BY provider_id LIMIT 65",&[])?;
            if profiles.len()>MAX_PROVIDERS {return Err(StoreError::corrupt());}
            for row in profiles {
                let provider=row[0].text()?;
                id(&provider).map_err(|_|StoreError::corrupt())?;
                let old=row[1].int()?;
                if old<1 {return Err(StoreError::corrupt());}
                let revision=next_revision(old)?;
                let generation=new_provider_generation()?;
                db.execute("INSERT INTO product_provider_versions VALUES(?,?,?,1)",&[provider.as_str().into(),generation.into(),revision.into()])?;
                db.execute("UPDATE product_provider_profiles SET revision=? WHERE provider_id=?",&[revision.into(),provider.into()])?;
            }
            // Old observations have no generation binding and cannot be trusted as matches.
            db.execute("DELETE FROM product_capability_evidence",&[])?;
            version=3;
        }
        if version!=SETTINGS_SCHEMA_VERSION {return Err(StoreError::corrupt());}
        db.execute("UPDATE product_settings_schema SET version=? WHERE singleton=1",&[version.into()])?;
        Ok(())
    })
}
