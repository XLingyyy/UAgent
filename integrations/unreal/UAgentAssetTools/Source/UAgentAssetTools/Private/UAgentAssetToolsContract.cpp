#include "UAgentAssetToolsContract.h"

#include "Dom/JsonValue.h"
#include "Misc/SecureHash.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

namespace UAgentAssetTools
{
	namespace
	{
		bool IsSafeRunId(const FString& RunId)
		{
			if (RunId.IsEmpty()) return false;
			for (const TCHAR Character : RunId)
			{
				if (!(FChar::IsAlnum(Character) || Character == TEXT('_') || Character == TEXT('-'))) return false;
			}
			return true;
		}

		bool IsSafeChangeSetId(const FString& ChangeSetId)
		{
			if (ChangeSetId.IsEmpty()) return false;
			for (const TCHAR Character : ChangeSetId)
			{
				if (!(FChar::IsAlnum(Character) || Character == TEXT('_') || Character == TEXT('-') || Character == TEXT('.') || Character == TEXT(':'))) return false;
			}
			return true;
		}

		bool IsSafeOperationId(const FString& OperationId)
		{
			if (OperationId.IsEmpty()) return false;
			for (const TCHAR Character : OperationId)
			{
				if (!(FChar::IsAlnum(Character) || Character == TEXT('_') || Character == TEXT('-'))) return false;
			}
			return true;
		}

		bool RequireString(const TSharedPtr<FJsonObject>& Params, const TCHAR* Field, FString& OutValue)
		{
			return Params.IsValid() && Params->TryGetStringField(Field, OutValue) && !OutValue.IsEmpty();
		}

		bool RequireBool(const TSharedPtr<FJsonObject>& Params, const TCHAR* Field, bool& OutValue)
		{
			if (!Params.IsValid()) return false;
			const TSharedPtr<FJsonValue> Value = Params->TryGetField(Field);
			if (!Value.IsValid() || Value->Type != EJson::Boolean) return false;
			OutValue = Value->AsBool();
			return true;
		}

		bool IsLowerHexSha1(const FString& Value)
		{
			if (Value.Len() != 40) return false;
			for (const TCHAR Character : Value)
			{
				if (!((Character >= TEXT('0') && Character <= TEXT('9')) || (Character >= TEXT('a') && Character <= TEXT('f')))) return false;
			}
			return true;
		}

		bool IsLowerHexSha256(const FString& Value)
		{
			if (Value.Len() != 64) return false;
			for (const TCHAR Character : Value)
			{
				if (!((Character >= TEXT('0') && Character <= TEXT('9')) || (Character >= TEXT('a') && Character <= TEXT('f')))) return false;
			}
			return true;
		}

		bool IsSafeNativeRegistrationId(const FString& Value)
		{
			if (Value.IsEmpty() || Value.Len() > 256) return false;
			for (const TCHAR Character : Value)
			{
				if (!(FChar::IsAlnum(Character)
					|| Character == TEXT('_')
					|| Character == TEXT('-')
					|| Character == TEXT('.')
					|| Character == TEXT(':')))
				{
					return false;
				}
			}
			return true;
		}

		bool RequireInteger(
			const TSharedPtr<FJsonObject>& Params,
			const TCHAR* Field,
			double Minimum,
			double Maximum,
			int64& OutValue)
		{
			double Value = 0.0;
			if (!Params.IsValid()
				|| !Params->TryGetNumberField(Field, Value)
				|| !FMath::IsFinite(Value)
				|| FMath::FloorToDouble(Value) != Value
				|| Value < Minimum
				|| Value > Maximum)
			{
				return false;
			}
			OutValue = static_cast<int64>(Value);
			return true;
		}

		const TSet<FString>& NativeCallFactFields()
		{
			static const TSet<FString> Fields = {
				TEXT("acceptedPlanBinding"),
				TEXT("nativeRegistrationId"),
				TEXT("nativePhase"),
				TEXT("nativeOperationIndex"),
				TEXT("nativeOperationCount"),
				TEXT("nativeCreatedAt"),
				TEXT("connectionGeneration"),
				TEXT("sessionGeneration"),
				TEXT("nativeSourceIdentity"),
				TEXT("nativeManifestIdentity"),
				TEXT("nativePluginIdentity"),
				TEXT("nativePackageIdentity"),
			};
			return Fields;
		}

		bool HasOnlyKnownFields(const TSharedPtr<FJsonObject>& Params, EOperation Operation)
		{
			static const TSet<FString> Common = {
				TEXT("changeSetId"), TEXT("runId"), TEXT("operationId"), TEXT("dryRun"), TEXT("execute"), TEXT("rollback"), TEXT("dryRunHash"),
				TEXT("acceptedPlanBinding"), TEXT("nativeRegistrationId"), TEXT("nativePhase"), TEXT("nativeOperationIndex"), TEXT("nativeOperationCount"),
				TEXT("nativeCreatedAt"), TEXT("connectionGeneration"), TEXT("sessionGeneration"), TEXT("nativeSourceIdentity"),
				TEXT("nativeManifestIdentity"), TEXT("nativePluginIdentity"), TEXT("nativePackageIdentity")
			};
			TSet<FString> Allowed = Common;
			switch (Operation)
			{
			case EOperation::CreateFolder: Allowed.Add(TEXT("folderPath")); break;
			case EOperation::Duplicate:
				Allowed.Add(TEXT("sourceAssetPath"));
				Allowed.Add(TEXT("targetAssetPath"));
				break;
			case EOperation::Rename:
			case EOperation::Move:
				Allowed.Add(TEXT("assetPath"));
				Allowed.Add(TEXT("targetAssetPath"));
				break;
			case EOperation::Delete:
			case EOperation::Save:
				Allowed.Add(TEXT("assetPath"));
				break;
			}
			if (Operation == EOperation::Save) Allowed.Add(TEXT("saveAll"));
			for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : Params->Values)
			{
				if (!Allowed.Contains(Pair.Key)) return false;
			}
			return true;
		}

		TSharedPtr<FJsonValue> StringValue(const FString& Value)
		{
			return MakeShared<FJsonValueString>(Value);
		}

		TSharedPtr<FJsonObject> StringSchema(const FString& Pattern)
		{
			TSharedPtr<FJsonObject> Schema = MakeShared<FJsonObject>();
			Schema->SetStringField(TEXT("type"), TEXT("string"));
			Schema->SetStringField(TEXT("pattern"), Pattern);
			return Schema;
		}
	}

	FString GetToolName(EOperation Operation)
	{
		switch (Operation)
		{
		case EOperation::CreateFolder: return TEXT("ue.asset.create_folder");
		case EOperation::Duplicate: return TEXT("ue.asset.duplicate");
		case EOperation::Rename: return TEXT("ue.asset.rename");
		case EOperation::Move: return TEXT("ue.asset.move");
		case EOperation::Delete: return TEXT("ue.asset.delete");
		case EOperation::Save: return TEXT("ue.asset.save");
		default: return FString();
		}
	}

	FString GetOperationName(EOperation Operation)
	{
		switch (Operation)
		{
		case EOperation::CreateFolder: return TEXT("create_folder");
		case EOperation::Duplicate: return TEXT("duplicate");
		case EOperation::Rename: return TEXT("rename");
		case EOperation::Move: return TEXT("move");
		case EOperation::Delete: return TEXT("delete");
		case EOperation::Save: return TEXT("save");
		default: return TEXT("unknown");
		}
	}

	FString GetRollbackAction(EOperation Operation)
	{
		switch (Operation)
		{
		case EOperation::CreateFolder: return TEXT("cleanup_empty_folder");
		case EOperation::Duplicate: return TEXT("delete_duplicate");
		case EOperation::Rename: return TEXT("rename_back");
		case EOperation::Move: return TEXT("move_back");
		case EOperation::Delete: return TEXT("none");
		case EOperation::Save: return TEXT("none");
		default: return TEXT("none");
		}
	}

	bool IsExactToolName(const FString& ToolName)
	{
		return ToolName == TEXT("ue.asset.create_folder")
			|| ToolName == TEXT("ue.asset.duplicate")
			|| ToolName == TEXT("ue.asset.rename")
			|| ToolName == TEXT("ue.asset.move")
			|| ToolName == TEXT("ue.asset.delete")
			|| ToolName == TEXT("ue.asset.save");
	}

	bool IsCanonicalGamePath(const FString& Path)
	{
		if (!Path.StartsWith(TEXT("/Game/")) || Path.Contains(TEXT("\\")) || Path.Contains(TEXT("..")) || Path.Contains(TEXT("//"))) return false;
		TArray<FString> Segments;
		Path.ParseIntoArray(Segments, TEXT("/"), true);
		if (Segments.Num() < 2 || Segments[0] != TEXT("Game")) return false;
		for (const FString& Segment : Segments)
		{
			if (Segment.IsEmpty()) return false;
			for (const TCHAR Character : Segment)
			{
				if (!(FChar::IsAlnum(Character) || Character == TEXT('_') || Character == TEXT('-'))) return false;
			}
		}
		return true;
	}

	bool IsStrictSandboxDescendant(const FString& Path, const FString& RunRoot)
	{
		return Path.StartsWith(RunRoot + TEXT("/")) && Path.Len() > RunRoot.Len() + 1;
	}

	FValidationResult ValidateArguments(EOperation Operation, const TSharedPtr<FJsonObject>& Params)
	{
		FValidationResult Result;
		if (!Params.IsValid()) { Result.Reason = TEXT("input_not_object"); return Result; }
		if (!HasOnlyKnownFields(Params, Operation)) { Result.Reason = TEXT("unknown_input_field"); return Result; }

		FString ChangeSetId;
		FString RunId;
		FString OperationId;
		if (!RequireString(Params, TEXT("changeSetId"), ChangeSetId) || !IsSafeChangeSetId(ChangeSetId)) { Result.Reason = TEXT("unsafe_change_set_id"); return Result; }
		if (!RequireString(Params, TEXT("runId"), RunId) || !IsSafeRunId(RunId)) { Result.Reason = TEXT("unsafe_run_id"); return Result; }
		if (!RequireString(Params, TEXT("operationId"), OperationId) || !IsSafeOperationId(OperationId)) { Result.Reason = TEXT("unsafe_operation_id"); return Result; }

		bool bDryRun = false;
		bool bExecute = false;
		bool bRollback = false;
		if (!RequireBool(Params, TEXT("dryRun"), bDryRun) || !RequireBool(Params, TEXT("execute"), bExecute) || !RequireBool(Params, TEXT("rollback"), bRollback))
		{
			Result.Reason = TEXT("phase_flags_must_be_boolean");
			return Result;
		}
		if ((bDryRun ? 1 : 0) + (bExecute ? 1 : 0) + (bRollback ? 1 : 0) != 1) { Result.Reason = TEXT("phase_flags_conflict"); return Result; }
		if (!bDryRun && !bRollback && !bExecute) { Result.Reason = TEXT("phase_required"); return Result; }
		if (bDryRun && Params->HasField(TEXT("dryRunHash")))
		{
			Result.Reason = TEXT("dry_run_hash_forbidden");
			return Result;
		}
		if (!bDryRun)
		{
			FString DryRunHash;
			if (!RequireString(Params, TEXT("dryRunHash"), DryRunHash) || !IsLowerHexSha1(DryRunHash)) { Result.Reason = TEXT("accepted_dry_run_hash_required"); return Result; }
		}
		const bool bHasAcceptedPlanBinding = Params->HasField(TEXT("acceptedPlanBinding"));
		if (bDryRun)
		{
			for (const FString& Field : NativeCallFactFields())
			{
				if (Params->HasField(Field))
				{
					Result.Reason = Field == TEXT("acceptedPlanBinding")
						? TEXT("accepted_plan_binding_forbidden_in_dry_run")
						: TEXT("native_call_facts_forbidden_in_dry_run");
					return Result;
				}
			}
		}
		if (!bDryRun)
		{
			FString AcceptedPlanBinding;
			FString NativeRegistrationId;
			FString NativePhase;
			FString NativeSourceIdentity;
			FString NativeManifestIdentity;
			FString NativePluginIdentity;
			FString NativePackageIdentity;
			int64 NativeOperationIndex = -1;
			int64 NativeOperationCount = 0;
			int64 NativeCreatedAt = 0;
			int64 ConnectionGeneration = 0;
			int64 SessionGeneration = 0;
			if (!bHasAcceptedPlanBinding)
			{
				Result.Reason = TEXT("accepted_plan_binding_required");
				return Result;
			}
			if (!RequireString(Params, TEXT("acceptedPlanBinding"), AcceptedPlanBinding) || !IsLowerHexSha256(AcceptedPlanBinding))
			{
				Result.Reason = TEXT("accepted_plan_binding_invalid");
				return Result;
			}
			if (!RequireString(Params, TEXT("nativeRegistrationId"), NativeRegistrationId)
				|| !IsSafeNativeRegistrationId(NativeRegistrationId))
			{
				Result.Reason = TEXT("native_registration_id_invalid");
				return Result;
			}
			if (!RequireString(Params, TEXT("nativePhase"), NativePhase)
				|| NativePhase != (bRollback ? TEXT("rollback") : TEXT("execute")))
			{
				Result.Reason = TEXT("native_phase_mismatch");
				return Result;
			}
			if (!RequireInteger(Params, TEXT("nativeOperationIndex"), 0.0, static_cast<double>(MAX_int32), NativeOperationIndex)
				|| !RequireInteger(Params, TEXT("nativeOperationCount"), 1.0, static_cast<double>(MAX_int32), NativeOperationCount)
				|| NativeOperationIndex >= NativeOperationCount)
			{
				Result.Reason = TEXT("native_operation_position_invalid");
				return Result;
			}
			if (!RequireInteger(Params, TEXT("nativeCreatedAt"), 1.0, 9007199254740991.0, NativeCreatedAt))
			{
				Result.Reason = TEXT("native_created_at_invalid");
				return Result;
			}
			if (!RequireInteger(Params, TEXT("connectionGeneration"), 1.0, 9007199254740991.0, ConnectionGeneration)
				|| !RequireInteger(Params, TEXT("sessionGeneration"), 1.0, 9007199254740991.0, SessionGeneration))
			{
				Result.Reason = TEXT("native_generation_invalid");
				return Result;
			}
			if (!RequireString(Params, TEXT("nativeSourceIdentity"), NativeSourceIdentity)
				|| !RequireString(Params, TEXT("nativeManifestIdentity"), NativeManifestIdentity)
				|| !RequireString(Params, TEXT("nativePluginIdentity"), NativePluginIdentity)
				|| !RequireString(Params, TEXT("nativePackageIdentity"), NativePackageIdentity)
				|| !IsLowerHexSha256(NativeSourceIdentity)
				|| !IsLowerHexSha256(NativeManifestIdentity)
				|| !IsLowerHexSha256(NativePluginIdentity)
				|| !IsLowerHexSha256(NativePackageIdentity))
			{
				Result.Reason = TEXT("native_identity_invalid");
				return Result;
			}
		}
		if (Operation == EOperation::Delete && bExecute) { Result.Reason = TEXT("forward_delete_forbidden"); return Result; }
		if (Operation == EOperation::Save)
		{
			bool bSaveAll = true;
			if (!RequireBool(Params, TEXT("saveAll"), bSaveAll) || bSaveAll) { Result.Reason = TEXT("save_all_forbidden"); return Result; }
		}

		Result.RunRoot = FString::Printf(TEXT("/Game/UAgentSandbox/%s"), *RunId);
		FString FirstPath;
		FString SecondPath;
		if (Operation == EOperation::CreateFolder)
		{
			if (!RequireString(Params, TEXT("folderPath"), FirstPath) || FirstPath != Result.RunRoot) { Result.Reason = TEXT("run_root_required"); return Result; }
		}
		else if (Operation == EOperation::Duplicate)
		{
			if (!RequireString(Params, TEXT("sourceAssetPath"), FirstPath) || !RequireString(Params, TEXT("targetAssetPath"), SecondPath) || FirstPath != TEXT("/Game/Test01") || !IsStrictSandboxDescendant(SecondPath, Result.RunRoot)) { Result.Reason = TEXT("duplicate_source_or_target_blocked"); return Result; }
		}
		else
		{
			if (!RequireString(Params, TEXT("assetPath"), FirstPath)) { Result.Reason = TEXT("sandbox_descendant_required"); return Result; }
			const bool bDeleteCleanupAtRunRoot = Operation == EOperation::Delete && bRollback && FirstPath == Result.RunRoot;
			if (!IsStrictSandboxDescendant(FirstPath, Result.RunRoot) && !bDeleteCleanupAtRunRoot) { Result.Reason = TEXT("sandbox_descendant_required"); return Result; }
			if (Operation == EOperation::Rename || Operation == EOperation::Move)
			{
				if (!RequireString(Params, TEXT("targetAssetPath"), SecondPath) || !IsStrictSandboxDescendant(SecondPath, Result.RunRoot)) { Result.Reason = TEXT("sandbox_descendant_required"); return Result; }
			}
		}
		if (!FirstPath.IsEmpty() && FirstPath != TEXT("/Game/Test01") && !IsCanonicalGamePath(FirstPath)) { Result.Reason = TEXT("non_canonical_asset_path"); return Result; }
		if (!SecondPath.IsEmpty() && !IsCanonicalGamePath(SecondPath)) { Result.Reason = TEXT("non_canonical_asset_path"); return Result; }
		if (Operation == EOperation::CreateFolder && !IsCanonicalGamePath(FirstPath)) { Result.Reason = TEXT("non_canonical_asset_path"); return Result; }
		Result.bValid = true;
		return Result;
	}

	FString ComputeDryRunHash(const TSharedPtr<FJsonObject>& Params)
	{
		if (!Params.IsValid()) return FString();
		FString Payload;
		TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Payload);
		Writer->WriteObjectStart();
		TArray<FString> Keys;
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : Params->Values)
		{
			if (Pair.Key != TEXT("dryRun")
				&& Pair.Key != TEXT("execute")
				&& Pair.Key != TEXT("rollback")
				&& Pair.Key != TEXT("dryRunHash")
				&& !NativeCallFactFields().Contains(Pair.Key))
			{
				Keys.Add(Pair.Key);
			}
		}
		Keys.Sort();
		for (const FString& Key : Keys)
		{
			const TSharedPtr<FJsonValue> JsonValue = Params->TryGetField(Key);
			if (!JsonValue.IsValid()) return FString();
			switch (JsonValue->Type)
			{
			case EJson::String: Writer->WriteValue(Key, JsonValue->AsString()); break;
			case EJson::Boolean: Writer->WriteValue(Key, JsonValue->AsBool()); break;
			case EJson::Number: Writer->WriteValue(Key, JsonValue->AsNumber()); break;
			case EJson::Null: return FString();
			default: return FString();
			}
		}
		Writer->WriteObjectEnd();
		Writer->Close();
		FTCHARToUTF8 Utf8(*Payload);
		uint8 Digest[FSHA1::DigestSize];
		FSHA1::HashBuffer(reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length(), Digest);
		return BytesToHex(Digest, UE_ARRAY_COUNT(Digest)).ToLower();
	}

	TSharedPtr<FJsonObject> BuildInputSchema(EOperation Operation)
	{
		TSharedPtr<FJsonObject> Schema = MakeShared<FJsonObject>();
		Schema->SetStringField(TEXT("type"), TEXT("object"));
		Schema->SetBoolField(TEXT("additionalProperties"), false);
		TSharedPtr<FJsonObject> Properties = MakeShared<FJsonObject>();
		Properties->SetObjectField(TEXT("changeSetId"), StringSchema(TEXT("^[A-Za-z0-9._:-]+$")));
		Properties->SetObjectField(TEXT("runId"), StringSchema(TEXT("^[A-Za-z0-9_-]+$")));
		Properties->SetObjectField(TEXT("operationId"), StringSchema(TEXT("^[A-Za-z0-9_-]+$")));
		for (const TCHAR* Field : {TEXT("dryRun"), TEXT("execute"), TEXT("rollback")})
		{
			TSharedPtr<FJsonObject> BooleanSchema = MakeShared<FJsonObject>();
			BooleanSchema->SetStringField(TEXT("type"), TEXT("boolean"));
			Properties->SetObjectField(Field, BooleanSchema);
		}
		Properties->SetObjectField(TEXT("dryRunHash"), StringSchema(TEXT("^[0-9a-f]{40}$")));
		Properties->SetObjectField(TEXT("acceptedPlanBinding"), StringSchema(TEXT("^[0-9a-f]{64}$")));
		Properties->SetObjectField(TEXT("nativeRegistrationId"), StringSchema(TEXT("^[A-Za-z0-9._:-]{1,256}$")));
		TSharedPtr<FJsonObject> NativePhase = MakeShared<FJsonObject>();
		NativePhase->SetStringField(TEXT("type"), TEXT("string"));
		TArray<TSharedPtr<FJsonValue>> NativePhaseValues;
		NativePhaseValues.Add(StringValue(TEXT("execute")));
		NativePhaseValues.Add(StringValue(TEXT("rollback")));
		NativePhase->SetArrayField(TEXT("enum"), NativePhaseValues);
		Properties->SetObjectField(TEXT("nativePhase"), NativePhase);
		auto IntegerSchema = [](double Minimum)
		{
			TSharedPtr<FJsonObject> Schema = MakeShared<FJsonObject>();
			Schema->SetStringField(TEXT("type"), TEXT("integer"));
			Schema->SetNumberField(TEXT("minimum"), Minimum);
			return Schema;
		};
		Properties->SetObjectField(TEXT("nativeOperationIndex"), IntegerSchema(0.0));
		Properties->SetObjectField(TEXT("nativeOperationCount"), IntegerSchema(1.0));
		Properties->SetObjectField(TEXT("nativeCreatedAt"), IntegerSchema(1.0));
		Properties->SetObjectField(TEXT("connectionGeneration"), IntegerSchema(1.0));
		Properties->SetObjectField(TEXT("sessionGeneration"), IntegerSchema(1.0));
		for (const TCHAR* Field : {
			TEXT("nativeSourceIdentity"),
			TEXT("nativeManifestIdentity"),
			TEXT("nativePluginIdentity"),
			TEXT("nativePackageIdentity"),
		})
		{
			Properties->SetObjectField(Field, StringSchema(TEXT("^[0-9a-f]{64}$")));
		}
		if (Operation == EOperation::CreateFolder) Properties->SetObjectField(TEXT("folderPath"), StringSchema(TEXT("^/Game/UAgentSandbox/[A-Za-z0-9_-]+$")));
		if (Operation == EOperation::Duplicate)
		{
			TSharedPtr<FJsonObject> Source = MakeShared<FJsonObject>(); Source->SetStringField(TEXT("const"), TEXT("/Game/Test01"));
			Properties->SetObjectField(TEXT("sourceAssetPath"), Source);
			Properties->SetObjectField(TEXT("targetAssetPath"), StringSchema(TEXT("^/Game/UAgentSandbox/[A-Za-z0-9_-]+/.+$")));
		}
		if (Operation == EOperation::Delete)
		{
			// ue.asset.delete is the native dispatcher for both delete_duplicate and
			// cleanup_empty_folder.  The latter carries the exact run root on rollback;
			// runtime validation still rejects every forward delete invocation.
			Properties->SetObjectField(TEXT("assetPath"), StringSchema(TEXT("^/Game/UAgentSandbox/[A-Za-z0-9_-]+(?:/.+)?$")));
		}
		else if (Operation != EOperation::CreateFolder && Operation != EOperation::Duplicate)
		{
			Properties->SetObjectField(TEXT("assetPath"), StringSchema(TEXT("^/Game/UAgentSandbox/[A-Za-z0-9_-]+/.+$")));
		}
		if (Operation == EOperation::Rename || Operation == EOperation::Move) Properties->SetObjectField(TEXT("targetAssetPath"), StringSchema(TEXT("^/Game/UAgentSandbox/[A-Za-z0-9_-]+/.+$")));
		if (Operation == EOperation::Save)
		{
			TSharedPtr<FJsonObject> SaveAll = MakeShared<FJsonObject>(); SaveAll->SetBoolField(TEXT("const"), false);
			Properties->SetObjectField(TEXT("saveAll"), SaveAll);
		}
		Schema->SetObjectField(TEXT("properties"), Properties);
		TArray<TSharedPtr<FJsonValue>> Required;
		for (const TCHAR* Field : {TEXT("changeSetId"), TEXT("runId"), TEXT("operationId"), TEXT("dryRun"), TEXT("execute"), TEXT("rollback")}) Required.Add(StringValue(Field));
		if (Operation == EOperation::CreateFolder) Required.Add(StringValue(TEXT("folderPath")));
		if (Operation == EOperation::Duplicate) { Required.Add(StringValue(TEXT("sourceAssetPath"))); Required.Add(StringValue(TEXT("targetAssetPath"))); }
		if (Operation != EOperation::CreateFolder && Operation != EOperation::Duplicate) Required.Add(StringValue(TEXT("assetPath")));
		if (Operation == EOperation::Rename || Operation == EOperation::Move) Required.Add(StringValue(TEXT("targetAssetPath")));
		if (Operation == EOperation::Save) Required.Add(StringValue(TEXT("saveAll")));
		Schema->SetArrayField(TEXT("required"), Required);

		// The descriptor is intentionally explicit about the phase-dependent
		// native binding: dry-runs cannot carry it, while execute/rollback cannot
		// cross the companion boundary without it. ValidateArguments remains the
		// authority for exact phase and type checks.
		TSharedPtr<FJsonObject> ExecuteIf = MakeShared<FJsonObject>();
		TSharedPtr<FJsonObject> ExecuteIfProperties = MakeShared<FJsonObject>();
		TSharedPtr<FJsonObject> DryRunFalse = MakeShared<FJsonObject>();
		DryRunFalse->SetBoolField(TEXT("const"), false);
		ExecuteIfProperties->SetObjectField(TEXT("dryRun"), DryRunFalse);
		ExecuteIf->SetObjectField(TEXT("properties"), ExecuteIfProperties);
		TArray<TSharedPtr<FJsonValue>> ExecuteIfRequired;
		ExecuteIfRequired.Add(StringValue(TEXT("dryRun")));
		ExecuteIf->SetArrayField(TEXT("required"), ExecuteIfRequired);
		TSharedPtr<FJsonObject> ExecuteThen = MakeShared<FJsonObject>();
		TArray<TSharedPtr<FJsonValue>> ExecuteThenRequired;
		for (const TCHAR* Field : {
			TEXT("dryRunHash"),
			TEXT("acceptedPlanBinding"),
			TEXT("nativeRegistrationId"),
			TEXT("nativePhase"),
			TEXT("nativeOperationIndex"),
			TEXT("nativeOperationCount"),
			TEXT("nativeCreatedAt"),
			TEXT("connectionGeneration"),
			TEXT("sessionGeneration"),
			TEXT("nativeSourceIdentity"),
			TEXT("nativeManifestIdentity"),
			TEXT("nativePluginIdentity"),
			TEXT("nativePackageIdentity"),
		})
		{
			ExecuteThenRequired.Add(StringValue(Field));
		}
		ExecuteThen->SetArrayField(TEXT("required"), ExecuteThenRequired);
		TSharedPtr<FJsonObject> ExecuteBindingCondition = MakeShared<FJsonObject>();
		ExecuteBindingCondition->SetObjectField(TEXT("if"), ExecuteIf);
		ExecuteBindingCondition->SetObjectField(TEXT("then"), ExecuteThen);
		TArray<TSharedPtr<FJsonValue>> InputConditions;
		InputConditions.Add(MakeShared<FJsonValueObject>(ExecuteBindingCondition));

		TSharedPtr<FJsonObject> DryRunIf = MakeShared<FJsonObject>();
		TSharedPtr<FJsonObject> DryRunIfProperties = MakeShared<FJsonObject>();
		TSharedPtr<FJsonObject> DryRunTrue = MakeShared<FJsonObject>();
		DryRunTrue->SetBoolField(TEXT("const"), true);
		DryRunIfProperties->SetObjectField(TEXT("dryRun"), DryRunTrue);
		DryRunIf->SetObjectField(TEXT("properties"), DryRunIfProperties);
		TArray<TSharedPtr<FJsonValue>> DryRunIfRequired;
		DryRunIfRequired.Add(StringValue(TEXT("dryRun")));
		DryRunIf->SetArrayField(TEXT("required"), DryRunIfRequired);

		TArray<TSharedPtr<FJsonValue>> ForbiddenNativeFacts;
		for (const TCHAR* Field : {
			TEXT("dryRunHash"),
			TEXT("acceptedPlanBinding"),
			TEXT("nativeRegistrationId"),
			TEXT("nativePhase"),
			TEXT("nativeOperationIndex"),
			TEXT("nativeOperationCount"),
			TEXT("nativeCreatedAt"),
			TEXT("connectionGeneration"),
			TEXT("sessionGeneration"),
			TEXT("nativeSourceIdentity"),
			TEXT("nativeManifestIdentity"),
			TEXT("nativePluginIdentity"),
			TEXT("nativePackageIdentity"),
		})
		{
			TSharedPtr<FJsonObject> RequiredField = MakeShared<FJsonObject>();
			TArray<TSharedPtr<FJsonValue>> RequiredFieldNames;
			RequiredFieldNames.Add(StringValue(Field));
			RequiredField->SetArrayField(TEXT("required"), RequiredFieldNames);
			TSharedPtr<FJsonObject> NotRequiredField = MakeShared<FJsonObject>();
			NotRequiredField->SetObjectField(TEXT("not"), RequiredField);
			ForbiddenNativeFacts.Add(MakeShared<FJsonValueObject>(NotRequiredField));
		}
		TSharedPtr<FJsonObject> DryRunThen = MakeShared<FJsonObject>();
		DryRunThen->SetArrayField(TEXT("allOf"), ForbiddenNativeFacts);
		TSharedPtr<FJsonObject> DryRunCondition = MakeShared<FJsonObject>();
		DryRunCondition->SetObjectField(TEXT("if"), DryRunIf);
		DryRunCondition->SetObjectField(TEXT("then"), DryRunThen);
		InputConditions.Add(MakeShared<FJsonValueObject>(DryRunCondition));
		Schema->SetArrayField(TEXT("allOf"), InputConditions);
		return Schema;
	}

	TSharedPtr<FJsonObject> BuildOutputSchema(EOperation Operation, const TSharedPtr<FJsonObject>& Identity)
	{
		TSharedPtr<FJsonObject> Schema = MakeShared<FJsonObject>();
		Schema->SetStringField(TEXT("type"), TEXT("object"));
		Schema->SetBoolField(TEXT("additionalProperties"), false);
		TSharedPtr<FJsonObject> Properties = MakeShared<FJsonObject>();
		for (const TCHAR* Field : {TEXT("blocked"), TEXT("wouldChange"), TEXT("approvalRequired"), TEXT("sideEffectObserved"), TEXT("rollbackAvailable")})
		{
			TSharedPtr<FJsonObject> BooleanSchema = MakeShared<FJsonObject>(); BooleanSchema->SetStringField(TEXT("type"), TEXT("boolean")); Properties->SetObjectField(Field, BooleanSchema);
		}
		TSharedPtr<FJsonObject> EffectStateSchema = MakeShared<FJsonObject>();
		EffectStateSchema->SetStringField(TEXT("type"), TEXT("string"));
		TArray<TSharedPtr<FJsonValue>> EffectStateValues;
		for (const TCHAR* Value : {TEXT("known_none"), TEXT("known_effect"), TEXT("known_partial"), TEXT("unknown")}) EffectStateValues.Add(StringValue(Value));
		EffectStateSchema->SetArrayField(TEXT("enum"), EffectStateValues);
		Properties->SetObjectField(TEXT("effectState"), EffectStateSchema);
		for (const TCHAR* Field : {TEXT("status"), TEXT("reasonCode"), TEXT("toolName"), TEXT("operation"), TEXT("phase"), TEXT("changeSetId"), TEXT("runId"), TEXT("operationId"), TEXT("sandboxRoot"), TEXT("dryRunHash"), TEXT("hashAlgorithm"), TEXT("schemaVersion"), TEXT("rollbackStatus"), TEXT("implementationStatus"), TEXT("evidenceId")})
		{
			TSharedPtr<FJsonObject> StringSchemaObject = MakeShared<FJsonObject>(); StringSchemaObject->SetStringField(TEXT("type"), TEXT("string")); Properties->SetObjectField(Field, StringSchemaObject);
		}
		auto StringArraySchema = []()
		{
			TSharedPtr<FJsonObject> ArraySchema = MakeShared<FJsonObject>();
			ArraySchema->SetStringField(TEXT("type"), TEXT("array"));
			TSharedPtr<FJsonObject> ItemSchema = MakeShared<FJsonObject>();
			ItemSchema->SetStringField(TEXT("type"), TEXT("string"));
			ArraySchema->SetObjectField(TEXT("items"), ItemSchema);
			return ArraySchema;
		};
		Properties->SetObjectField(TEXT("wouldRead"), StringArraySchema());
		Properties->SetObjectField(TEXT("wouldModify"), StringArraySchema());
		TSharedPtr<FJsonObject> AffectedAssetsSchema = MakeShared<FJsonObject>();
		AffectedAssetsSchema->SetStringField(TEXT("type"), TEXT("object"));
		AffectedAssetsSchema->SetBoolField(TEXT("additionalProperties"), false);
		TSharedPtr<FJsonObject> AffectedProperties = MakeShared<FJsonObject>();
		AffectedProperties->SetObjectField(TEXT("readOnlySources"), StringArraySchema());
		AffectedProperties->SetObjectField(TEXT("sandboxTargets"), StringArraySchema());
		AffectedProperties->SetObjectField(TEXT("externalTargets"), StringArraySchema());
		AffectedAssetsSchema->SetObjectField(TEXT("properties"), AffectedProperties);
		TArray<TSharedPtr<FJsonValue>> AffectedRequired;
		for (const TCHAR* Field : {TEXT("readOnlySources"), TEXT("sandboxTargets"), TEXT("externalTargets")}) AffectedRequired.Add(StringValue(Field));
		AffectedAssetsSchema->SetArrayField(TEXT("required"), AffectedRequired);
		Properties->SetObjectField(TEXT("affectedAssets"), AffectedAssetsSchema);
		TSharedPtr<FJsonObject> RollbackSchema = MakeShared<FJsonObject>();
		RollbackSchema->SetStringField(TEXT("type"), TEXT("object"));
		RollbackSchema->SetBoolField(TEXT("additionalProperties"), false);
		TSharedPtr<FJsonObject> RollbackProperties = MakeShared<FJsonObject>();
		RollbackProperties->SetObjectField(TEXT("strategy"), StringSchema(TEXT("^ledger_inverse$")));
		RollbackProperties->SetObjectField(TEXT("inverseOperation"), StringSchema(TEXT("^[a-z_]+$")));
		TSharedPtr<FJsonObject> ExecutionEnabled = MakeShared<FJsonObject>(); ExecutionEnabled->SetStringField(TEXT("type"), TEXT("boolean"));
		RollbackProperties->SetObjectField(TEXT("executionEnabled"), ExecutionEnabled);
		RollbackSchema->SetObjectField(TEXT("properties"), RollbackProperties);
		TArray<TSharedPtr<FJsonValue>> RollbackRequired;
		for (const TCHAR* Field : {TEXT("strategy"), TEXT("inverseOperation"), TEXT("executionEnabled")}) RollbackRequired.Add(StringValue(Field));
		RollbackSchema->SetArrayField(TEXT("required"), RollbackRequired);
		Properties->SetObjectField(TEXT("rollbackPlan"), RollbackSchema);
		TSharedPtr<FJsonObject> QuerySchema = MakeShared<FJsonObject>();
		QuerySchema->SetStringField(TEXT("type"), TEXT("object"));
		QuerySchema->SetBoolField(TEXT("additionalProperties"), false);
		TSharedPtr<FJsonObject> QueryProperties = MakeShared<FJsonObject>();
		QueryProperties->SetObjectField(TEXT("queryKind"), StringSchema(TEXT("^asset_registry_snapshot$")));
		TSharedPtr<FJsonObject> ReadOnly = MakeShared<FJsonObject>(); ReadOnly->SetBoolField(TEXT("const"), true);
		QueryProperties->SetObjectField(TEXT("readOnly"), ReadOnly);
		QueryProperties->SetObjectField(TEXT("paths"), StringArraySchema());
		QuerySchema->SetObjectField(TEXT("properties"), QueryProperties);
		TArray<TSharedPtr<FJsonValue>> QueryRequired;
		for (const TCHAR* Field : {TEXT("queryKind"), TEXT("readOnly"), TEXT("paths")}) QueryRequired.Add(StringValue(Field));
		QuerySchema->SetArrayField(TEXT("required"), QueryRequired);
		TSharedPtr<FJsonObject> QueriesSchema = MakeShared<FJsonObject>();
		QueriesSchema->SetStringField(TEXT("type"), TEXT("array"));
		QueriesSchema->SetObjectField(TEXT("items"), QuerySchema);
		Properties->SetObjectField(TEXT("externalEvidenceQueries"), QueriesSchema);
		Schema->SetObjectField(TEXT("properties"), Properties);
		TArray<TSharedPtr<FJsonValue>> Required;
		for (const TCHAR* Field : {TEXT("blocked"), TEXT("status"), TEXT("reasonCode"), TEXT("toolName"), TEXT("operation"), TEXT("phase"), TEXT("changeSetId"), TEXT("runId"), TEXT("operationId"), TEXT("sandboxRoot"), TEXT("wouldChange"), TEXT("wouldRead"), TEXT("wouldModify"), TEXT("affectedAssets"), TEXT("rollbackPlan"), TEXT("externalEvidenceQueries"), TEXT("dryRunHash"), TEXT("hashAlgorithm"), TEXT("schemaVersion"), TEXT("approvalRequired"), TEXT("sideEffectObserved"), TEXT("effectState"), TEXT("rollbackAvailable"), TEXT("rollbackStatus"), TEXT("implementationStatus"), TEXT("evidenceId")}) Required.Add(StringValue(Field));
		Schema->SetArrayField(TEXT("required"), Required);
		if (Identity.IsValid()) Schema->SetObjectField(TEXT("x-uagent-plugin"), Identity);

		TSharedPtr<FJsonObject> DryRunSchema = MakeShared<FJsonObject>();
		DryRunSchema->SetStringField(TEXT("type"), TEXT("object"));
		DryRunSchema->SetBoolField(TEXT("additionalProperties"), false);
		DryRunSchema->SetObjectField(TEXT("properties"), Properties);
		DryRunSchema->SetArrayField(TEXT("required"), Required);
		TSharedPtr<FJsonObject> DryRunPhase = MakeShared<FJsonObject>();
		DryRunPhase->SetStringField(TEXT("const"), TEXT("dry_run"));
		TSharedPtr<FJsonObject> DryRunProperties = MakeShared<FJsonObject>();
		DryRunProperties->SetObjectField(TEXT("phase"), DryRunPhase);
		TSharedPtr<FJsonObject> DryRunConstraint = MakeShared<FJsonObject>();
		DryRunConstraint->SetObjectField(TEXT("properties"), DryRunProperties);
		TArray<TSharedPtr<FJsonValue>> DryRunRequired;
		DryRunRequired.Add(StringValue(TEXT("phase")));
		DryRunConstraint->SetArrayField(TEXT("required"), DryRunRequired);
		TArray<TSharedPtr<FJsonValue>> DryRunConditions;
		DryRunConditions.Add(MakeShared<FJsonValueObject>(DryRunConstraint));
		DryRunSchema->SetArrayField(TEXT("allOf"), DryRunConditions);

		TSharedPtr<FJsonObject> Contract = MakeShared<FJsonObject>();
		Contract->SetStringField(TEXT("schemaVersion"), ContractVersion);
		Contract->SetObjectField(TEXT("input"), BuildInputSchema(Operation));
		Contract->SetObjectField(TEXT("dryRunSchema"), DryRunSchema);
		Contract->SetObjectField(TEXT("rollbackContract"), RollbackSchema);
		Contract->SetObjectField(TEXT("affectedAssetsSchema"), AffectedAssetsSchema);
		Contract->SetObjectField(TEXT("evidenceQuery"), QuerySchema);
		Schema->SetObjectField(TEXT("x-uagent-contract"), Contract);
		return Schema;
	}
}
