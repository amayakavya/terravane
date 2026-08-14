# Terravane Android App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native Android app (Kotlin + Jetpack Compose) with full
feature parity to the existing `web/` operator console and consumer trace
page, as a pure client of the existing `server/` REST API.

**Architecture:** Single-activity Compose app, MVVM. One Retrofit interface
(`TerravaneApi`) talks to the existing REST API. One `TerravaneRepository`
wraps it. Each screen has a `ViewModel` (StateFlow) + a Composable. Nav
Compose wires screens together. No chain logic, no wallet, no offline
write queue — server does all of that already.

**Tech Stack:** Kotlin, Jetpack Compose + Material 3, Retrofit + OkHttp,
kotlinx.serialization, Navigation Compose, CameraX + ML Kit Barcode
Scanning, Coil (SVG), Jetpack DataStore, JUnit + Turbine for ViewModel tests.

**Spec:** [docs/superpowers/specs/2026-08-14-android-app-design.md](../specs/2026-08-14-android-app-design.md)

## Global Constraints

- Min SDK 24, target latest stable.
- Base URL is user-editable at runtime (Settings screen), default = deployed `render.yaml` origin, never hardcoded per-build.
- No chain logic duplicated client-side; every write goes through `/api/actions/*` and every read through `/api/*` exactly as documented in the spec's endpoint table.
- Server error bodies are `{ "error": "<ContractErrorName>" }` or `{ "error": "message" }` — surface `error` verbatim in the UI, never a generic "failed" string.
- English + Hindi via `strings.xml` / `values-hi/strings.xml` for every user-facing string introduced.
- Palette: green/gold agriculture theme (see Task 1 for exact tokens), matching web `tailwind.config.cjs` and the SIH deck.
- Package name: `com.terravane.app`.

---

## File Structure

```
app/
  build.gradle.kts
  src/main/
    AndroidManifest.xml
    java/com/terravane/app/
      TerravaneApp.kt                      Application class, DI wiring (manual, no DI framework)
      data/
        api/TerravaneApi.kt                Retrofit interface
        api/HttpClient.kt                  OkHttp/Retrofit builder, base-URL-aware
        dto/*.kt                           Wire DTOs (kotlinx.serialization), one file per resource group
        SettingsStore.kt                   DataStore: base URL, selected participant/role
        TerravaneRepository.kt             Single repository wrapping TerravaneApi
      domain/
        model/*.kt                         UI-facing domain models (mapped from DTOs)
      ui/
        theme/Theme.kt, Color.kt, Type.kt  Compose theme (green/gold)
        common/StatusChip.kt, LoadingState.kt, ErrorBanner.kt
        nav/NavGraph.kt, Routes.kt
        signin/SignInScreen.kt, SignInViewModel.kt
        settings/SettingsScreen.kt, SettingsViewModel.kt
        dashboard/DashboardScreen.kt, DashboardViewModel.kt
        lot/LotScreen.kt, LotViewModel.kt, LotTabs.kt (Overview/Route/Timeline/Lineage/ColdChain/Actions)
        handover/HandoverSheet.kt, HandoverViewModel.kt
        register/RegisterScreen.kt, RegisterViewModel.kt
        inspect/InspectScreen.kt, InspectViewModel.kt
        inventory/InventoryScreen.kt, InventoryViewModel.kt
        search/SearchScreen.kt, SearchViewModel.kt
        notifications/NotificationsScreen.kt, NotificationsViewModel.kt
        regulator/RegulatorScreen.kt, RegulatorViewModel.kt
        trace/TraceScanScreen.kt, TraceResultScreen.kt, TraceViewModel.kt
        label/LabelScreen.kt, LabelViewModel.kt
    res/
      values/strings.xml, values-hi/strings.xml
      values/colors.xml
  src/test/java/com/terravane/app/...       ViewModel unit tests, one per screen ViewModel
```

---

### Task 1: Project scaffolding, theme, and navigation skeleton

**Files:**
- Create: `terravane/android/settings.gradle.kts`
- Create: `terravane/android/build.gradle.kts`
- Create: `terravane/android/app/build.gradle.kts`
- Create: `terravane/android/app/src/main/AndroidManifest.xml`
- Create: `terravane/android/app/src/main/java/com/terravane/app/TerravaneApp.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/MainActivity.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/theme/Color.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/theme/Theme.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/Routes.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/nav/RoutesTest.kt`

**Interfaces:**
- Produces: `Routes` object with one `const val` route string per screen (`SIGN_IN`, `DASHBOARD`, `LOT`, `REGISTER`, `INSPECT`, `INVENTORY`, `SEARCH`, `NOTIFICATIONS`, `REGULATOR`, `TRACE_SCAN`, `TRACE_RESULT`, `LABEL`, `SETTINGS`), and `Routes.lot(id: Int): String` / `Routes.label(id: Int): String` / `Routes.traceResult(id: Int): String` helpers for parameterized routes.
- Produces: `TerravaneTheme(content: @Composable () -> Unit)` Compose theme wrapper, used by every screen task below.

- [ ] **Step 1: Create Gradle project files**

`terravane/android/settings.gradle.kts`:
```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "terravane-android"
include(":app")
```

`terravane/android/build.gradle.kts`:
```kotlin
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "1.9.24" apply false
}
```

`terravane/android/app/build.gradle.kts`:
```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.terravane.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.terravane.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation("androidx.navigation:navigation-compose:2.7.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.2")

    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-kotlinx-serialization:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    implementation("androidx.datastore:datastore-preferences:1.1.1")

    implementation("androidx.camera:camera-core:1.3.4")
    implementation("androidx.camera:camera-camera2:1.3.4")
    implementation("androidx.camera:camera-lifecycle:1.3.4")
    implementation("androidx.camera:camera-view:1.3.4")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")

    implementation("io.coil-kt:coil-compose:2.6.0")
    implementation("io.coil-kt:coil-svg:2.6.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("app.cash.turbine:turbine:1.1.0")
}
```

`terravane/android/app/src/main/AndroidManifest.xml`:
```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />

    <application
        android:name=".TerravaneApp"
        android:label="Terravane"
        android:theme="@style/Theme.Material3.DayNight.NoActionBar"
        android:usesCleartextTraffic="false">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:theme="@style/Theme.Material3.DayNight.NoActionBar">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

- [ ] **Step 2: Write the theme**

`terravane/android/app/src/main/java/com/terravane/app/ui/theme/Color.kt`:
```kotlin
package com.terravane.app.ui.theme

import androidx.compose.ui.graphics.Color

// Matches web/tailwind.config.cjs agriculture green/gold palette.
val TerravaneGreen = Color(0xFF0B6E4F)
val TerravaneGreenDark = Color(0xFF063D2C)
val TerravaneGold = Color(0xFFC9971F)
val TerravaneCream = Color(0xFFF7F3E8)
val TerravaneRed = Color(0xFFB3261E)
val TerravaneAmber = Color(0xFFB8791A)
```

`terravane/android/app/src/main/java/com/terravane/app/ui/theme/Theme.kt`:
```kotlin
package com.terravane.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColors = lightColorScheme(
    primary = TerravaneGreen,
    secondary = TerravaneGold,
    error = TerravaneRed,
    background = TerravaneCream
)

private val DarkColors = darkColorScheme(
    primary = TerravaneGreen,
    secondary = TerravaneGold,
    error = TerravaneRed,
    background = TerravaneGreenDark
)

@Composable
fun TerravaneTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(colorScheme = colors, content = content)
}
```

- [ ] **Step 3: Write routes**

`terravane/android/app/src/main/java/com/terravane/app/ui/nav/Routes.kt`:
```kotlin
package com.terravane.app.ui.nav

object Routes {
    const val SIGN_IN = "sign_in"
    const val DASHBOARD = "dashboard"
    const val LOT = "lot/{id}"
    const val REGISTER = "register"
    const val INSPECT = "inspect/{id}"
    const val INVENTORY = "inventory"
    const val SEARCH = "search"
    const val NOTIFICATIONS = "notifications"
    const val REGULATOR = "regulator"
    const val TRACE_SCAN = "trace_scan"
    const val TRACE_RESULT = "trace_result/{id}"
    const val LABEL = "label/{id}"
    const val SETTINGS = "settings"

    fun lot(id: Int) = "lot/$id"
    fun inspect(id: Int) = "inspect/$id"
    fun traceResult(id: Int) = "trace_result/$id"
    fun label(id: Int) = "label/$id"
}
```

- [ ] **Step 4: Write a failing route-format test**

`terravane/android/app/src/test/java/com/terravane/app/ui/nav/RoutesTest.kt`:
```kotlin
package com.terravane.app.ui.nav

import org.junit.Assert.assertEquals
import org.junit.Test

class RoutesTest {
    @Test
    fun `lot route substitutes id`() {
        assertEquals("lot/42", Routes.lot(42))
    }

    @Test
    fun `trace result route substitutes id`() {
        assertEquals("trace_result/7", Routes.traceResult(7))
    }
}
```

- [ ] **Step 5: Run the test to verify it fails, then passes**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.nav.RoutesTest"`
Expected first run: FAIL (`Routes` doesn't compile yet — file doesn't exist). After Step 3, expected: PASS.

- [ ] **Step 6: Write NavGraph skeleton (screens wired as they're built in later tasks)**

`terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`:
```kotlin
package com.terravane.app.ui.nav

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

@Composable
fun TerravaneNavGraph(navController: NavHostController = rememberNavController()) {
    NavHost(navController = navController, startDestination = Routes.SIGN_IN) {
        composable(Routes.SIGN_IN) {
            // wired in Task 4
        }
    }
}
```

- [ ] **Step 7: Write MainActivity and Application class**

`terravane/android/app/src/main/java/com/terravane/app/TerravaneApp.kt`:
```kotlin
package com.terravane.app

import android.app.Application

class TerravaneApp : Application()
```

`terravane/android/app/src/main/java/com/terravane/app/MainActivity.kt`:
```kotlin
package com.terravane.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.terravane.app.ui.nav.TerravaneNavGraph
import com.terravane.app.ui.theme.TerravaneTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TerravaneTheme {
                TerravaneNavGraph()
            }
        }
    }
}
```

- [ ] **Step 8: Commit**

```bash
git add terravane/android
git commit -m "Scaffold Android project, theme, and nav skeleton"
```

---

### Task 2: Networking layer — DTOs, Retrofit API, Settings store, Repository

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/data/dto/Batch.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/data/dto/Participant.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/data/dto/Stats.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/data/dto/Notification.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/data/dto/Trace.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/data/dto/ActionResult.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/data/api/TerravaneApi.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/data/api/HttpClient.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/data/SettingsStore.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/data/TerravaneRepository.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/data/TerravaneRepositoryTest.kt`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent of UI).
- Produces: `TerravaneApi` Retrofit interface (used by `TerravaneRepository` and nowhere else); `TerravaneRepository` with suspend functions `health()`, `stats()`, `participants()`, `batches(q, stage, flag)`, `batch(id)`, `lineage(id)`, `notifications(as)`, `trace(id)`, `qrUrl(id): String`, and action functions `harvest(...)`, `transfer(...)`, `accept(...)`, `cancel(...)`, `inspect(...)`, `recall(...)` each returning `Result<ActionResult>`. `SettingsStore` with `baseUrlFlow: Flow<String>`, `suspend fun setBaseUrl(url: String)`, `selectedParticipantFlow: Flow<String?>`, `suspend fun setSelectedParticipant(address: String)`. All later screen ViewModels depend on `TerravaneRepository` and `SettingsStore` only — never on `TerravaneApi` directly.

- [ ] **Step 1: Write DTOs matching `server/index.js` response shapes**

`terravane/android/app/src/main/java/com/terravane/app/data/dto/Participant.kt`:
```kotlin
package com.terravane.app.data.dto

import kotlinx.serialization.Serializable

@Serializable
data class ParticipantDto(
    val address: String,
    val name: String?,
    val location: String?,
    val roles: List<String>,
    val active: Boolean?,
    val lat: Double?,
    val lon: Double?,
    val holding: Int? = null
)
```

`terravane/android/app/src/main/java/com/terravane/app/data/dto/Batch.kt`:
```kotlin
package com.terravane.app.data.dto

import kotlinx.serialization.Serializable

@Serializable
data class OriginDto(
    val farm: ParticipantDto?,
    val location: String?,
    val geohash: String?,
    val lat: Double?,
    val lon: Double?
)

@Serializable
data class CountsDto(
    val handovers: Int,
    val telemetry: Int,
    val certifications: Int,
    val inspections: Int,
    val activeCertifications: Int,
    val failedInspections: Int
)

@Serializable
data class BatchDto(
    val id: Int,
    val produceType: String,
    val variety: String?,
    val quantity: String,
    val soldQuantity: String?,
    val unit: String,
    val stage: Int,
    val stageName: String,
    val recalled: Boolean,
    val coldChainRequired: Boolean,
    val coldChainBreached: Boolean,
    val tempWindow: List<Double>?,
    val harvestedAt: Long,
    val createdAt: Long,
    val origin: OriginDto,
    val custodian: ParticipantDto?,
    val pendingCustodian: ParticipantDto?,
    val metadataURI: String?,
    val metadataHash: String?,
    val counts: CountsDto,
    val custodyIntact: Boolean,
    val parents: List<Int>,
    val children: List<Int>
)

@Serializable
data class HandoverDto(
    val from: ParticipantDto?,
    val to: ParticipantDto?,
    val proposedAt: Long,
    val settledAt: Long,
    val geohash: String?,
    val note: String?,
    val documentHash: String?,
    val accepted: Boolean,
    val cancelled: Boolean
)

@Serializable
data class CertificationDto(
    val scheme: String,
    val certifier: ParticipantDto?,
    val issuedAt: Long,
    val expiresAt: Long,
    val evidenceURI: String?,
    val evidenceHash: String?,
    val revoked: Boolean,
    val revocationReason: String?,
    val active: Boolean
)

@Serializable
data class TelemetryDto(
    val reporter: ParticipantDto?,
    val observedAt: Long,
    val tempC: Double,
    val humidityPct: Double,
    val geohash: String?,
    val excursion: Boolean
)

@Serializable
data class InspectionDto(
    val inspector: ParticipantDto?,
    val at: Long,
    val grade: Int,
    val passed: Boolean,
    val findings: String?,
    val reportHash: String?
)

@Serializable
data class RecallDto(
    val initiator: ParticipantDto?,
    val at: Long,
    val severity: Int,
    val reason: String?,
    val rootBatch: Int
)

@Serializable
data class DossierDto(
    val batch: BatchDto,
    val attributes: kotlinx.serialization.json.JsonElement? = null,
    val handovers: List<HandoverDto>,
    val certifications: List<CertificationDto>,
    val farmCertifications: List<CertificationDto>,
    val telemetry: List<TelemetryDto>,
    val inspections: List<InspectionDto>,
    val recall: RecallDto?
)

@Serializable
data class LineageNodeDto(
    val id: Int,
    val produceType: String,
    val variety: String?,
    val quantity: String,
    val unit: String,
    val stage: Int,
    val stageName: String,
    val recalled: Boolean,
    val coldChainBreached: Boolean,
    val custodian: String?,
    val isFocus: Boolean
)

@Serializable
data class LineageEdgeDto(val from: Int, val to: Int)

@Serializable
data class LineageDto(val nodes: List<LineageNodeDto>, val edges: List<LineageEdgeDto>)
```

`terravane/android/app/src/main/java/com/terravane/app/data/dto/Stats.kt`:
```kotlin
package com.terravane.app.data.dto

import kotlinx.serialization.Serializable

@Serializable
data class StageCountDto(val stage: Int, val stageName: String, val count: Int)

@Serializable
data class ProduceCountDto(val produceType: String, val unit: String, val lots: Int, val quantity: Long)

@Serializable
data class StatsDto(
    val batches: Int,
    val recalled: Int,
    val breached: Int,
    val openHandovers: Int,
    val custodyGaps: Int,
    val failedInspections: Int,
    val participants: Int,
    val events: Int,
    val byStage: List<StageCountDto>,
    val byProduce: List<ProduceCountDto>
)

@Serializable
data class HealthDto(
    val ok: Boolean,
    val ready: Boolean,
    val chainHead: Long?,
    val indexedBlock: Long,
    val signingEnabled: Boolean
)
```

`terravane/android/app/src/main/java/com/terravane/app/data/dto/Notification.kt`:
```kotlin
package com.terravane.app.data.dto

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class NotificationDto(
    val name: String,
    val batchId: Int,
    val actor: ParticipantDto?,
    val at: Long,
    val txHash: String?,
    val args: JsonElement,
    val mine: Boolean
)
```

`terravane/android/app/src/main/java/com/terravane/app/data/dto/Trace.kt`:
```kotlin
package com.terravane.app.data.dto

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class WarningDto(val level: String, val text: String)

@Serializable
data class JourneyStepDto(val at: Long, val label: String, val actor: String?, val place: String?)

@Serializable
data class TraceDto(
    val id: Int,
    val verdict: String,
    val warnings: List<WarningDto>,
    val batch: BatchDto,
    val attributes: JsonElement? = null,
    val journey: List<JourneyStepDto>,
    val certifications: List<CertificationDto>,
    val telemetry: List<TelemetryDto>,
    val lineage: LineageDto,
    val recall: RecallDto?
)
```

`terravane/android/app/src/main/java/com/terravane/app/data/dto/ActionResult.kt`:
```kotlin
package com.terravane.app.data.dto

import kotlinx.serialization.Serializable

@Serializable
data class ActionResultDto(
    val ok: Boolean = true,
    val txHash: String? = null,
    val block: Long? = null,
    val gasUsed: String? = null,
    val batchId: Int? = null,
    val propagated: List<Int>? = null,
    val children: List<Int>? = null
)

@Serializable
data class ApiErrorDto(val error: String)

@Serializable
data class HarvestRequestDto(
    val `as`: String,
    val produceType: String,
    val variety: String? = null,
    val quantity: String,
    val unit: String = "kg",
    val harvestedAt: Long = 0,
    val originGeohash: String? = null,
    val originLocation: String? = null,
    val coldChainRequired: Boolean = false,
    val minTempC: Double = 0.0,
    val maxTempC: Double = 0.0
)

@Serializable
data class TransferRequestDto(val `as`: String, val to: String, val geohash: String? = null, val note: String? = null)

@Serializable
data class AcceptRequestDto(val `as`: String, val geohash: String? = null)

@Serializable
data class InspectRequestDto(val `as`: String, val grade: Int, val passed: Boolean, val findings: String? = null)

@Serializable
data class RecallRequestDto(val `as`: String, val severity: Int = 2, val reason: String, val propagate: Boolean = true)
```

- [ ] **Step 2: Write the Retrofit interface**

`terravane/android/app/src/main/java/com/terravane/app/data/api/TerravaneApi.kt`:
```kotlin
package com.terravane.app.data.api

import com.terravane.app.data.dto.*
import retrofit2.http.*

interface TerravaneApi {
    @GET("api/health")
    suspend fun health(): HealthDto

    @GET("api/stats")
    suspend fun stats(): StatsDto

    @GET("api/participants")
    suspend fun participants(): List<ParticipantDto>

    @GET("api/batches")
    suspend fun batches(
        @Query("q") q: String? = null,
        @Query("stage") stage: Int? = null,
        @Query("flag") flag: String? = null
    ): List<BatchDto>

    @GET("api/batches/{id}")
    suspend fun batch(@Path("id") id: Int): DossierDto

    @GET("api/batches/{id}/lineage")
    suspend fun lineage(@Path("id") id: Int): LineageDto

    @GET("api/notifications")
    suspend fun notifications(@Query("as") address: String): List<NotificationDto>

    @GET("api/trace/{id}")
    suspend fun trace(@Path("id") id: Int): TraceDto

    @POST("api/actions/batches")
    suspend fun harvest(@Body body: HarvestRequestDto): ActionResultDto

    @POST("api/actions/batches/{id}/transfer")
    suspend fun transfer(@Path("id") id: Int, @Body body: TransferRequestDto): ActionResultDto

    @POST("api/actions/batches/{id}/accept")
    suspend fun accept(@Path("id") id: Int, @Body body: AcceptRequestDto): ActionResultDto

    @POST("api/actions/batches/{id}/cancel")
    suspend fun cancel(@Path("id") id: Int, @Body body: Map<String, String>): ActionResultDto

    @POST("api/actions/batches/{id}/inspect")
    suspend fun inspect(@Path("id") id: Int, @Body body: InspectRequestDto): ActionResultDto

    @POST("api/actions/batches/{id}/recall")
    suspend fun recall(@Path("id") id: Int, @Body body: RecallRequestDto): ActionResultDto
}
```

- [ ] **Step 3: Write the OkHttp/Retrofit builder**

`terravane/android/app/src/main/java/com/terravane/app/data/api/HttpClient.kt`:
```kotlin
package com.terravane.app.data.api

import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

object HttpClient {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    fun build(baseUrl: String): TerravaneApi {
        val normalized = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        val client = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build()
        return Retrofit.Builder()
            .baseUrl(normalized)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(TerravaneApi::class.java)
    }
}
```

- [ ] **Step 4: Write the Settings store**

`terravane/android/app/src/main/java/com/terravane/app/data/SettingsStore.kt`:
```kotlin
package com.terravane.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "terravane_settings")

class SettingsStore(private val context: Context, private val defaultBaseUrl: String) {
    private val baseUrlKey = stringPreferencesKey("base_url")
    private val participantKey = stringPreferencesKey("selected_participant")

    val baseUrlFlow: Flow<String> = context.dataStore.data.map { it[baseUrlKey] ?: defaultBaseUrl }
    val selectedParticipantFlow: Flow<String?> = context.dataStore.data.map { it[participantKey] }

    suspend fun setBaseUrl(url: String) {
        context.dataStore.edit { it[baseUrlKey] = url }
    }

    suspend fun setSelectedParticipant(address: String) {
        context.dataStore.edit { it[participantKey] = address }
    }

    suspend fun clearSelectedParticipant() {
        context.dataStore.edit { it.remove(participantKey) }
    }
}
```

- [ ] **Step 5: Write the Repository**

`terravane/android/app/src/main/java/com/terravane/app/data/TerravaneRepository.kt`:
```kotlin
package com.terravane.app.data

import com.terravane.app.data.api.TerravaneApi
import com.terravane.app.data.dto.*
import retrofit2.HttpException
import kotlinx.serialization.json.Json

class TerravaneRepository(private val api: TerravaneApi) {

    private val json = Json { ignoreUnknownKeys = true }

    suspend fun health(): Result<HealthDto> = runCatching { api.health() }.mapApiError()
    suspend fun stats(): Result<StatsDto> = runCatching { api.stats() }.mapApiError()
    suspend fun participants(): Result<List<ParticipantDto>> = runCatching { api.participants() }.mapApiError()

    suspend fun batches(q: String? = null, stage: Int? = null, flag: String? = null): Result<List<BatchDto>> =
        runCatching { api.batches(q, stage, flag) }.mapApiError()

    suspend fun batch(id: Int): Result<DossierDto> = runCatching { api.batch(id) }.mapApiError()
    suspend fun lineage(id: Int): Result<LineageDto> = runCatching { api.lineage(id) }.mapApiError()
    suspend fun notifications(asAddress: String): Result<List<NotificationDto>> =
        runCatching { api.notifications(asAddress) }.mapApiError()
    suspend fun trace(id: Int): Result<TraceDto> = runCatching { api.trace(id) }.mapApiError()

    suspend fun harvest(body: HarvestRequestDto): Result<ActionResultDto> =
        runCatching { api.harvest(body) }.mapApiError()
    suspend fun transfer(id: Int, body: TransferRequestDto): Result<ActionResultDto> =
        runCatching { api.transfer(id, body) }.mapApiError()
    suspend fun accept(id: Int, body: AcceptRequestDto): Result<ActionResultDto> =
        runCatching { api.accept(id, body) }.mapApiError()
    suspend fun cancel(id: Int, asAddress: String): Result<ActionResultDto> =
        runCatching { api.cancel(id, mapOf("as" to asAddress)) }.mapApiError()
    suspend fun inspect(id: Int, body: InspectRequestDto): Result<ActionResultDto> =
        runCatching { api.inspect(id, body) }.mapApiError()
    suspend fun recall(id: Int, body: RecallRequestDto): Result<ActionResultDto> =
        runCatching { api.recall(id, body) }.mapApiError()

    /** Server errors come back as `{"error": "..."}`; surface that string, not "HTTP 400". */
    private fun <T> Result<T>.mapApiError(): Result<T> = recoverCatching { throwable ->
        if (throwable is HttpException) {
            val body = throwable.response()?.errorBody()?.string()
            val message = body?.let { runCatching { json.decodeFromString(ApiErrorDto.serializer(), it).error }.getOrNull() }
            throw RuntimeException(message ?: throwable.message())
        }
        throw throwable
    }
}
```

- [ ] **Step 6: Write the failing repository error-mapping test**

`terravane/android/app/src/test/java/com/terravane/app/data/TerravaneRepositoryTest.kt`:
```kotlin
package com.terravane.app.data

import com.terravane.app.data.api.TerravaneApi
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class TerravaneRepositoryTest {

    @Test
    fun `surfaces server error message instead of generic HTTP failure`() = runTest {
        val api = object : TerravaneApi by FakeApi() {
            override suspend fun stats() = throw HttpException(
                Response.error<Any>(400, """{"error":"NotCustodian"}""".toResponseBody("application/json".toMediaType()))
            )
        }
        val repo = TerravaneRepository(api)

        val result = repo.stats()

        assertEquals("NotCustodian", result.exceptionOrNull()?.message)
    }
}
```

(`FakeApi` is a minimal `TerravaneApi` stub with every method throwing
`NotImplementedError()`, added in the same file for this test only.)

- [ ] **Step 7: Run the test to verify it fails, then implement and pass**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.data.TerravaneRepositoryTest"`
Expected before Step 5's `mapApiError`: FAIL (raw HttpException message, not `NotCustodian`). After: PASS.

- [ ] **Step 8: Wire repository creation into TerravaneApp**

Modify `terravane/android/app/src/main/java/com/terravane/app/TerravaneApp.kt`:
```kotlin
package com.terravane.app

import android.app.Application
import com.terravane.app.data.SettingsStore
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.api.HttpClient
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

class TerravaneApp : Application() {
    companion object {
        const val DEFAULT_BASE_URL = "https://terravane.onrender.com/"
    }

    lateinit var settingsStore: SettingsStore
        private set

    lateinit var repository: TerravaneRepository
        private set

    override fun onCreate() {
        super.onCreate()
        settingsStore = SettingsStore(this, DEFAULT_BASE_URL)
        val baseUrl = runBlocking { settingsStore.baseUrlFlow.first() }
        repository = TerravaneRepository(HttpClient.build(baseUrl))
    }

    /** Called by the Settings screen when the user changes the base URL, to rebuild the client without restarting the app. */
    fun rebuildRepository(baseUrl: String) {
        repository = TerravaneRepository(HttpClient.build(baseUrl))
    }
}
```

- [ ] **Step 9: Commit**

```bash
git add terravane/android
git commit -m "Add networking layer: DTOs, Retrofit API, settings store, repository"
```

---

### Task 3: Settings screen (base URL)

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/settings/SettingsViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/settings/SettingsScreen.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/settings/SettingsViewModelTest.kt`

**Interfaces:**
- Consumes: `SettingsStore` (Task 2).
- Produces: `SettingsViewModel(settingsStore: SettingsStore, onBaseUrlChanged: (String) -> Unit)` exposing `val baseUrl: StateFlow<String>` and `fun save(newUrl: String)`. `SettingsScreen(viewModel: SettingsViewModel)` composable, registered at `Routes.SETTINGS` in Task 1's `NavGraph`.

- [ ] **Step 1: Write the failing ViewModel test**

`terravane/android/app/src/test/java/com/terravane/app/ui/settings/SettingsViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.settings

import app.cash.turbine.test
import com.terravane.app.data.SettingsStore
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SettingsViewModelTest {
    @Test
    fun `save updates the store and notifies the callback`() = runTest {
        var notified: String? = null
        val fakeStore = FakeSettingsStore()
        val viewModel = SettingsViewModel(fakeStore, onBaseUrlChanged = { notified = it })

        viewModel.save("http://192.168.1.20:4300/")

        assertEquals("http://192.168.1.20:4300/", fakeStore.savedBaseUrl)
        assertEquals("http://192.168.1.20:4300/", notified)
    }
}
```

(`FakeSettingsStore` is a small test double implementing the same
suspend-function surface as `SettingsStore`, added in the same file.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.settings.SettingsViewModelTest"`
Expected: FAIL (`SettingsViewModel` unresolved).

- [ ] **Step 3: Write the ViewModel**

`terravane/android/app/src/main/java/com/terravane/app/ui/settings/SettingsViewModel.kt`:
```kotlin
package com.terravane.app.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.SettingsStore
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(
    private val settingsStore: SettingsStore,
    private val onBaseUrlChanged: (String) -> Unit
) : ViewModel() {

    val baseUrl: StateFlow<String> = settingsStore.baseUrlFlow.stateIn(
        viewModelScope, SharingStarted.Eagerly, ""
    )

    fun save(newUrl: String) {
        viewModelScope.launch {
            settingsStore.setBaseUrl(newUrl)
            onBaseUrlChanged(newUrl)
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.settings.SettingsViewModelTest"`
Expected: PASS.

- [ ] **Step 5: Write the screen**

`terravane/android/app/src/main/java/com/terravane/app/ui/settings/SettingsScreen.kt`:
```kotlin
package com.terravane.app.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun SettingsScreen(viewModel: SettingsViewModel) {
    val currentUrl by viewModel.baseUrl.collectAsState()
    var draft by remember(currentUrl) { mutableStateOf(currentUrl) }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("API base URL", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = draft,
            onValueChange = { draft = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )
        Spacer(Modifier.height(12.dp))
        Button(onClick = { viewModel.save(draft) }) {
            Text("Save")
        }
    }
}
```

- [ ] **Step 6: Commit**

```bash
git add terravane/android
git commit -m "Add Settings screen for configurable API base URL"
```

---

### Task 4: Sign-in screen

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/domain/model/Session.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/signin/SignInViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/signin/SignInScreen.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/signin/SignInViewModelTest.kt`

**Interfaces:**
- Consumes: `TerravaneRepository.participants()` (Task 2), `SettingsStore.setSelectedParticipant` (Task 2).
- Produces: `SignInUiState` sealed interface (`Loading`, `Loaded(participants: List<ParticipantDto>)`, `Error(message: String)`), `SignInViewModel(repository: TerravaneRepository, settingsStore: SettingsStore).uiState: StateFlow<SignInUiState>` and `fun selectParticipant(address: String, onDone: () -> Unit)`. Every later screen that needs "who am I" reads `SettingsStore.selectedParticipantFlow` directly — Sign-in is the only writer.

- [ ] **Step 1: Write the failing ViewModel test**

`terravane/android/app/src/test/java/com/terravane/app/ui/signin/SignInViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.signin

import app.cash.turbine.test
import com.terravane.app.data.dto.ParticipantDto
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SignInViewModelTest {
    @Test
    fun `loads participants into state on init`() = runTest {
        val fakeRepo = FakeTerravaneRepository(
            participantsResult = Result.success(
                listOf(ParticipantDto("0xabc", "Karnal Farms", "Karnal", listOf("farmer"), true, null, null))
            )
        )
        val viewModel = SignInViewModel(fakeRepo, FakeSettingsStore())

        viewModel.uiState.test {
            assertEquals(SignInUiState.Loading, awaitItem())
            val loaded = awaitItem()
            assertTrue(loaded is SignInUiState.Loaded)
            assertEquals("Karnal Farms", (loaded as SignInUiState.Loaded).participants.first().name)
        }
    }

    @Test
    fun `selecting a participant persists it to settings`() = runTest {
        val fakeStore = FakeSettingsStore()
        val viewModel = SignInViewModel(FakeTerravaneRepository(), fakeStore)
        var done = false

        viewModel.selectParticipant("0xabc", onDone = { done = true })

        assertEquals("0xabc", fakeStore.savedParticipant)
        assertTrue(done)
    }
}
```

(`FakeTerravaneRepository` and the earlier `FakeSettingsStore` are
shared test doubles; add `FakeTerravaneRepository` in this file with
constructor defaults returning `Result.success(emptyList())` etc., and
override methods actually exercised.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.signin.SignInViewModelTest"`
Expected: FAIL (types unresolved).

- [ ] **Step 3: Write the domain Session model**

`terravane/android/app/src/main/java/com/terravane/app/domain/model/Session.kt`:
```kotlin
package com.terravane.app.domain.model

data class Session(val address: String, val name: String?, val roles: List<String>)
```

- [ ] **Step 4: Write the ViewModel**

`terravane/android/app/src/main/java/com/terravane/app/ui/signin/SignInViewModel.kt`:
```kotlin
package com.terravane.app.ui.signin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.SettingsStore
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.dto.ParticipantDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface SignInUiState {
    data object Loading : SignInUiState
    data class Loaded(val participants: List<ParticipantDto>) : SignInUiState
    data class Error(val message: String) : SignInUiState
}

class SignInViewModel(
    private val repository: TerravaneRepository,
    private val settingsStore: SettingsStore
) : ViewModel() {

    private val _uiState = MutableStateFlow<SignInUiState>(SignInUiState.Loading)
    val uiState: StateFlow<SignInUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.participants().fold(
                onSuccess = { _uiState.value = SignInUiState.Loaded(it) },
                onFailure = { _uiState.value = SignInUiState.Error(it.message ?: "failed to load participants") }
            )
        }
    }

    fun selectParticipant(address: String, onDone: () -> Unit) {
        viewModelScope.launch {
            settingsStore.setSelectedParticipant(address)
            onDone()
        }
    }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.signin.SignInViewModelTest"`
Expected: PASS.

- [ ] **Step 6: Write the screen**

`terravane/android/app/src/main/java/com/terravane/app/ui/signin/SignInScreen.kt`:
```kotlin
package com.terravane.app.ui.signin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun SignInScreen(viewModel: SignInViewModel, onSignedIn: () -> Unit) {
    val state by viewModel.uiState.collectAsState()

    when (val s = state) {
        is SignInUiState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) {
            CircularProgressIndicator()
        }
        is SignInUiState.Error -> Box(Modifier.fillMaxSize().padding(16.dp)) {
            Text("Could not load participants: ${s.message}")
        }
        is SignInUiState.Loaded -> LazyColumn(Modifier.fillMaxSize().padding(16.dp)) {
            items(s.participants) { participant ->
                ListItem(
                    headlineContent = { Text(participant.name ?: participant.address) },
                    supportingContent = { Text(participant.roles.joinToString(", ")) },
                    modifier = Modifier.clickable {
                        viewModel.selectParticipant(participant.address, onSignedIn)
                    }
                )
                Divider()
            }
        }
    }
}
```

(Add `import androidx.compose.foundation.clickable` alongside the
other imports above.)

- [ ] **Step 7: Wire into NavGraph**

Modify `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`:
```kotlin
package com.terravane.app.ui.nav

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.terravane.app.ui.signin.SignInScreen
import com.terravane.app.ui.signin.SignInViewModel

@Composable
fun TerravaneNavGraph(
    navController: NavHostController = rememberNavController(),
    signInViewModel: SignInViewModel
) {
    NavHost(navController = navController, startDestination = Routes.SIGN_IN) {
        composable(Routes.SIGN_IN) {
            SignInScreen(signInViewModel) {
                navController.navigate(Routes.DASHBOARD) {
                    popUpTo(Routes.SIGN_IN) { inclusive = true }
                }
            }
        }
    }
}
```

Modify `terravane/android/app/src/main/java/com/terravane/app/MainActivity.kt` to construct
`SignInViewModel(app.repository, app.settingsStore)` (via a small factory) and pass it in — full
`ViewModelProvider.Factory` wiring is finalized in Task 15 once every screen's ViewModel exists.

- [ ] **Step 8: Commit**

```bash
git add terravane/android
git commit -m "Add Sign-in screen with participant/role selection"
```

---

### Task 5: Dashboard screen

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/dashboard/DashboardViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/dashboard/DashboardScreen.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/dashboard/DashboardViewModelTest.kt`

**Interfaces:**
- Consumes: `TerravaneRepository.stats()`, `.batches(custodian=)`, `.notifications(as=)` (Task 2); `SettingsStore.selectedParticipantFlow` (Task 2).
- Produces: `DashboardUiState(stats: StatsDto?, holdings: List<BatchDto>, pendingSignature: List<BatchDto>, recentNotifications: List<NotificationDto>, loading: Boolean, error: String?)`, `DashboardViewModel` exposing `uiState: StateFlow<DashboardUiState>` and `fun refresh()`. Downstream tasks (Lot, Register, Handover) are reached by tapping a batch row, which calls `onOpenLot(batchId: Int)` passed into `DashboardScreen`.

- [ ] **Step 1: Write the failing ViewModel test**

`terravane/android/app/src/test/java/com/terravane/app/ui/dashboard/DashboardViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.dashboard

import app.cash.turbine.test
import com.terravane.app.data.dto.StatsDto
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class DashboardViewModelTest {
    @Test
    fun `refresh loads stats and clears loading flag`() = runTest {
        val stats = StatsDto(
            batches = 14, recalled = 1, breached = 1, openHandovers = 1, custodyGaps = 1,
            failedInspections = 1, participants = 9, events = 61, byStage = emptyList(), byProduce = emptyList()
        )
        val fakeRepo = FakeTerravaneRepository(statsResult = Result.success(stats))
        val viewModel = DashboardViewModel(fakeRepo, FakeSettingsStore(selectedParticipant = "0xabc"))

        viewModel.uiState.test {
            awaitItem() // initial loading state
            val loaded = awaitItem()
            assertEquals(14, loaded.stats?.batches)
            assertEquals(false, loaded.loading)
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.dashboard.DashboardViewModelTest"`
Expected: FAIL (types unresolved).

- [ ] **Step 3: Write the ViewModel**

`terravane/android/app/src/main/java/com/terravane/app/ui/dashboard/DashboardViewModel.kt`:
```kotlin
package com.terravane.app.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.SettingsStore
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.dto.BatchDto
import com.terravane.app.data.dto.NotificationDto
import com.terravane.app.data.dto.StatsDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class DashboardUiState(
    val stats: StatsDto? = null,
    val holdings: List<BatchDto> = emptyList(),
    val pendingSignature: List<BatchDto> = emptyList(),
    val recentNotifications: List<NotificationDto> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null
)

class DashboardViewModel(
    private val repository: TerravaneRepository,
    private val settingsStore: SettingsStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            val address = settingsStore.selectedParticipantFlow.first()

            val statsResult = repository.stats()
            val holdingsResult = address?.let { repository.batches(stage = null, flag = null).let { r -> r } }
            val pendingResult = address?.let { repository.batches(flag = "open") }
            val notificationsResult = address?.let { repository.notifications(it) }

            val failure = listOfNotNull(statsResult.exceptionOrNull(), holdingsResult?.exceptionOrNull())
                .firstOrNull()

            _uiState.value = DashboardUiState(
                stats = statsResult.getOrNull(),
                holdings = holdingsResult?.getOrNull().orEmpty()
                    .filter { it.custodian?.address.equals(address, ignoreCase = true) },
                pendingSignature = pendingResult?.getOrNull().orEmpty()
                    .filter { it.pendingCustodian?.address.equals(address, ignoreCase = true) },
                recentNotifications = notificationsResult?.getOrNull().orEmpty().take(10),
                loading = false,
                error = failure?.message
            )
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.dashboard.DashboardViewModelTest"`
Expected: PASS.

- [ ] **Step 5: Write the screen**

`terravane/android/app/src/main/java/com/terravane/app/ui/dashboard/DashboardScreen.kt`:
```kotlin
package com.terravane.app.ui.dashboard

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel,
    onOpenLot: (Int) -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenInventory: () -> Unit,
    onOpenSearch: () -> Unit,
    onOpenRegister: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()

    LazyColumn(Modifier.fillMaxSize().padding(16.dp)) {
        item {
            Text("Terravane", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            state.stats?.let {
                Text("${it.batches} lots — ${it.recalled} recalled — ${it.breached} cold-chain breaches")
            }
            state.error?.let { Text("Error: $it", color = MaterialTheme.colorScheme.error) }
            Spacer(Modifier.height(16.dp))
            Text("Pending your signature (${state.pendingSignature.size})", style = MaterialTheme.typography.titleMedium)
        }
        items(state.pendingSignature) { batch ->
            ListItem(
                headlineContent = { Text("Lot #${batch.id} — ${batch.produceType}") },
                supportingContent = { Text("from ${batch.custodian?.name ?: "unknown"}") },
                modifier = Modifier.clickable { onOpenLot(batch.id) }
            )
        }
        item {
            Spacer(Modifier.height(16.dp))
            Text("Your holdings (${state.holdings.size})", style = MaterialTheme.typography.titleMedium)
        }
        items(state.holdings) { batch ->
            ListItem(
                headlineContent = { Text("Lot #${batch.id} — ${batch.produceType}") },
                supportingContent = { Text(batch.stageName) },
                modifier = Modifier.clickable { onOpenLot(batch.id) }
            )
        }
    }
}
```

- [ ] **Step 6: Wire into NavGraph**

Modify `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt` to add, inside the
`NavHost` block after the sign-in `composable`:
```kotlin
        composable(Routes.DASHBOARD) {
            DashboardScreen(
                viewModel = dashboardViewModel,
                onOpenLot = { id -> navController.navigate(Routes.lot(id)) },
                onOpenNotifications = { navController.navigate(Routes.NOTIFICATIONS) },
                onOpenInventory = { navController.navigate(Routes.INVENTORY) },
                onOpenSearch = { navController.navigate(Routes.SEARCH) },
                onOpenRegister = { navController.navigate(Routes.REGISTER) }
            )
        }
```
and add `dashboardViewModel: DashboardViewModel` to `TerravaneNavGraph`'s parameter list.

- [ ] **Step 7: Commit**

```bash
git add terravane/android
git commit -m "Add Dashboard screen with stats, holdings, and pending signatures"
```

---

### Task 6: Lot dossier screen (Overview, Route, Timeline, Lineage, Cold Chain tabs)

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/lot/LotViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/lot/LotScreen.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/lot/LotTabs.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/lot/LotViewModelTest.kt`

**Interfaces:**
- Consumes: `TerravaneRepository.batch(id)`, `.lineage(id)` (Task 2).
- Produces: `LotUiState(dossier: DossierDto?, lineage: LineageDto?, loading: Boolean, error: String?)`, `LotViewModel(repository, batchId: Int)` with `uiState: StateFlow<LotUiState>` and `fun refresh()`. `LotScreen` renders 6 tabs — 5 read-only here (Actions/Handover tab is Task 7). `onOpenHandover: () -> Unit` and `onOpenChildLot: (Int) -> Unit` callbacks passed in.

- [ ] **Step 1: Write the failing ViewModel test**

`terravane/android/app/src/test/java/com/terravane/app/ui/lot/LotViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.lot

import app.cash.turbine.test
import com.terravane.app.data.dto.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class LotViewModelTest {
    @Test
    fun `refresh loads dossier and lineage together`() = runTest {
        val batch = BatchDto(
            id = 5, produceType = "Rice", variety = "Basmati", quantity = "500", soldQuantity = "0",
            unit = "kg", stage = 2, stageName = "Packed", recalled = false, coldChainRequired = false,
            coldChainBreached = false, tempWindow = null, harvestedAt = 0, createdAt = 0,
            origin = OriginDto(null, "Karnal", null, null, null), custodian = null, pendingCustodian = null,
            metadataURI = null, metadataHash = null,
            counts = CountsDto(0, 0, 0, 0, 0, 0), custodyIntact = true, parents = emptyList(), children = emptyList()
        )
        val dossier = DossierDto(batch, null, emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), null)
        val fakeRepo = FakeTerravaneRepository(
            batchResult = Result.success(dossier),
            lineageResult = Result.success(LineageDto(emptyList(), emptyList()))
        )
        val viewModel = LotViewModel(fakeRepo, batchId = 5)

        viewModel.uiState.test {
            awaitItem() // loading
            val loaded = awaitItem()
            assertEquals(5, loaded.dossier?.batch?.id)
            assertEquals(false, loaded.loading)
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.lot.LotViewModelTest"`
Expected: FAIL (types unresolved).

- [ ] **Step 3: Write the ViewModel**

`terravane/android/app/src/main/java/com/terravane/app/ui/lot/LotViewModel.kt`:
```kotlin
package com.terravane.app.ui.lot

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.dto.DossierDto
import com.terravane.app.data.dto.LineageDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class LotUiState(
    val dossier: DossierDto? = null,
    val lineage: LineageDto? = null,
    val loading: Boolean = true,
    val error: String? = null
)

class LotViewModel(
    private val repository: TerravaneRepository,
    private val batchId: Int
) : ViewModel() {

    private val _uiState = MutableStateFlow(LotUiState())
    val uiState: StateFlow<LotUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            val dossierResult = repository.batch(batchId)
            val lineageResult = repository.lineage(batchId)
            _uiState.value = LotUiState(
                dossier = dossierResult.getOrNull(),
                lineage = lineageResult.getOrNull(),
                loading = false,
                error = dossierResult.exceptionOrNull()?.message ?: lineageResult.exceptionOrNull()?.message
            )
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.lot.LotViewModelTest"`
Expected: PASS.

- [ ] **Step 5: Write the tab content composables**

`terravane/android/app/src/main/java/com/terravane/app/ui/lot/LotTabs.kt`:
```kotlin
package com.terravane.app.ui.lot

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.terravane.app.data.dto.DossierDto
import com.terravane.app.data.dto.LineageDto

@Composable
fun OverviewTab(dossier: DossierDto) {
    val b = dossier.batch
    Column(Modifier.padding(16.dp)) {
        Text("${b.produceType} ${b.variety.orEmpty()}")
        Text("Quantity: ${b.quantity} ${b.unit}")
        Text("Stage: ${b.stageName}")
        if (b.recalled) Text("RECALLED")
        if (b.coldChainBreached) Text("Cold chain breached")
        Text("Custodian: ${b.custodian?.name ?: "unassigned"}")
    }
}

@Composable
fun RouteTab(dossier: DossierDto) {
    LazyColumn(Modifier.padding(16.dp)) {
        items(dossier.handovers) { h ->
            Text("${h.from?.name ?: "?"} -> ${h.to?.name ?: "?"} (${if (h.accepted) "accepted" else "pending"})")
        }
    }
}

@Composable
fun TimelineTab(dossier: DossierDto) {
    LazyColumn(Modifier.padding(16.dp)) {
        items(dossier.inspections) { i ->
            Text("Inspection: grade ${i.grade}, ${if (i.passed) "passed" else "failed"}")
        }
        items(dossier.certifications) { c ->
            Text("Certification: ${c.scheme} (${if (c.active) "active" else "inactive"})")
        }
    }
}

@Composable
fun LineageTab(lineage: LineageDto?, onOpenLot: (Int) -> Unit) {
    LazyColumn(Modifier.padding(16.dp)) {
        items(lineage?.nodes.orEmpty()) { node ->
            Text(
                "Lot #${node.id} — ${node.stageName}${if (node.recalled) " (recalled)" else ""}",
                modifier = Modifier.clickable { onOpenLot(node.id) }
            )
        }
    }
}

@Composable
fun ColdChainTab(dossier: DossierDto) {
    LazyColumn(Modifier.padding(16.dp)) {
        items(dossier.telemetry) { t ->
            Text("${t.tempC}°C / ${t.humidityPct}% ${if (t.excursion) "EXCURSION" else ""}")
        }
    }
}
```

- [ ] **Step 6: Write the screen with tab switcher**

`terravane/android/app/src/main/java/com/terravane/app/ui/lot/LotScreen.kt`:
```kotlin
package com.terravane.app.ui.lot

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

private val tabTitles = listOf("Overview", "Route", "Timeline", "Lineage", "Cold Chain", "Actions")

@Composable
fun LotScreen(
    viewModel: LotViewModel,
    onOpenLot: (Int) -> Unit,
    onOpenHandover: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    var tab by remember { mutableStateOf(0) }

    Column(Modifier.fillMaxSize()) {
        TabRow(selectedTabIndex = tab) {
            tabTitles.forEachIndexed { index, title ->
                Tab(selected = tab == index, onClick = { tab = index }, text = { Text(title) })
            }
        }

        when {
            state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            state.dossier == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Could not load lot: ${state.error}")
            }
            else -> when (tab) {
                0 -> OverviewTab(state.dossier!!)
                1 -> RouteTab(state.dossier!!)
                2 -> TimelineTab(state.dossier!!)
                3 -> LineageTab(state.lineage, onOpenLot)
                4 -> ColdChainTab(state.dossier!!)
                5 -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Button(onClick = onOpenHandover) { Text("Propose / accept handover") }
                }
            }
        }
    }
}
```

- [ ] **Step 7: Wire into NavGraph with an `Int` argument**

Modify `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`, adding:
```kotlin
        composable(
            route = Routes.LOT,
            arguments = listOf(navArgument("id") { type = NavType.IntType })
        ) { backStackEntry ->
            val id = backStackEntry.arguments?.getInt("id") ?: return@composable
            LotScreen(
                viewModel = lotViewModelFactory(id),
                onOpenLot = { childId -> navController.navigate(Routes.lot(childId)) },
                onOpenHandover = { navController.navigate(Routes.lot(id)) } // replaced with a real handover route in Task 7
            )
        }
```
with imports `androidx.navigation.NavType` and `androidx.navigation.navArgument`, and
`lotViewModelFactory: (Int) -> LotViewModel` added to `TerravaneNavGraph`'s parameters (a
lambda supplied by `MainActivity` that builds a fresh `LotViewModel(repository, id)` per lot).

- [ ] **Step 8: Commit**

```bash
git add terravane/android
git commit -m "Add Lot dossier screen with Overview/Route/Timeline/Lineage/ColdChain tabs"
```

---

### Task 7: Handover — propose / accept / cancel

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/handover/HandoverViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/handover/HandoverScreen.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/Routes.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/handover/HandoverViewModelTest.kt`

**Interfaces:**
- Consumes: `TerravaneRepository.transfer(id, TransferRequestDto)`, `.accept(id, AcceptRequestDto)`, `.cancel(id, address)`, `.participants()` (Task 2); `SettingsStore.selectedParticipantFlow` (Task 2).
- Produces: `HandoverUiState(recipients: List<ParticipantDto>, submitting: Boolean, error: String?, done: Boolean)`, `HandoverViewModel(repository, settingsStore, batchId: Int)` with `fun proposeTransfer(toAddress: String, note: String)`, `fun acceptTransfer()`, `fun cancelTransfer()`.

- [ ] **Step 1: Add the route**

Modify `terravane/android/app/src/main/java/com/terravane/app/ui/nav/Routes.kt`, adding:
```kotlin
    const val HANDOVER = "handover/{id}"
    fun handover(id: Int) = "handover/$id"
```

- [ ] **Step 2: Write the failing ViewModel test**

`terravane/android/app/src/test/java/com/terravane/app/ui/handover/HandoverViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.handover

import app.cash.turbine.test
import com.terravane.app.data.dto.ActionResultDto
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HandoverViewModelTest {
    @Test
    fun `propose transfer marks done on success`() = runTest {
        val fakeRepo = FakeTerravaneRepository(transferResult = Result.success(ActionResultDto()))
        val viewModel = HandoverViewModel(fakeRepo, FakeSettingsStore(selectedParticipant = "0xabc"), batchId = 5)

        viewModel.proposeTransfer(toAddress = "0xdef", note = "handing to distributor")

        viewModel.uiState.test {
            val state = awaitItem()
            assertTrue(state.done)
            assertEquals(null, state.error)
        }
    }

    @Test
    fun `propose transfer surfaces server error and does not mark done`() = runTest {
        val fakeRepo = FakeTerravaneRepository(transferResult = Result.failure(RuntimeException("NotCustodian")))
        val viewModel = HandoverViewModel(fakeRepo, FakeSettingsStore(selectedParticipant = "0xabc"), batchId = 5)

        viewModel.proposeTransfer(toAddress = "0xdef", note = "")

        viewModel.uiState.test {
            val state = awaitItem()
            assertEquals("NotCustodian", state.error)
            assertTrue(!state.done)
        }
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.handover.HandoverViewModelTest"`
Expected: FAIL (types unresolved).

- [ ] **Step 4: Write the ViewModel**

`terravane/android/app/src/main/java/com/terravane/app/ui/handover/HandoverViewModel.kt`:
```kotlin
package com.terravane.app.ui.handover

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.SettingsStore
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.dto.AcceptRequestDto
import com.terravane.app.data.dto.ParticipantDto
import com.terravane.app.data.dto.TransferRequestDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class HandoverUiState(
    val recipients: List<ParticipantDto> = emptyList(),
    val submitting: Boolean = false,
    val error: String? = null,
    val done: Boolean = false
)

class HandoverViewModel(
    private val repository: TerravaneRepository,
    private val settingsStore: SettingsStore,
    private val batchId: Int
) : ViewModel() {

    private val _uiState = MutableStateFlow(HandoverUiState())
    val uiState: StateFlow<HandoverUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.participants().onSuccess { list ->
                _uiState.value = _uiState.value.copy(recipients = list)
            }
        }
    }

    fun proposeTransfer(toAddress: String, note: String) {
        viewModelScope.launch {
            val me = settingsStore.selectedParticipantFlow.first() ?: return@launch
            _uiState.value = _uiState.value.copy(submitting = true, error = null)
            repository.transfer(batchId, TransferRequestDto(`as` = me, to = toAddress, note = note)).fold(
                onSuccess = { _uiState.value = _uiState.value.copy(submitting = false, done = true) },
                onFailure = { _uiState.value = _uiState.value.copy(submitting = false, error = it.message) }
            )
        }
    }

    fun acceptTransfer() {
        viewModelScope.launch {
            val me = settingsStore.selectedParticipantFlow.first() ?: return@launch
            _uiState.value = _uiState.value.copy(submitting = true, error = null)
            repository.accept(batchId, AcceptRequestDto(`as` = me)).fold(
                onSuccess = { _uiState.value = _uiState.value.copy(submitting = false, done = true) },
                onFailure = { _uiState.value = _uiState.value.copy(submitting = false, error = it.message) }
            )
        }
    }

    fun cancelTransfer() {
        viewModelScope.launch {
            val me = settingsStore.selectedParticipantFlow.first() ?: return@launch
            _uiState.value = _uiState.value.copy(submitting = true, error = null)
            repository.cancel(batchId, me).fold(
                onSuccess = { _uiState.value = _uiState.value.copy(submitting = false, done = true) },
                onFailure = { _uiState.value = _uiState.value.copy(submitting = false, error = it.message) }
            )
        }
    }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.handover.HandoverViewModelTest"`
Expected: PASS.

- [ ] **Step 6: Write the screen**

`terravane/android/app/src/main/java/com/terravane/app/ui/handover/HandoverScreen.kt`:
```kotlin
package com.terravane.app.ui.handover

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.material3.ExposedDropdownMenuBox

@Composable
fun HandoverScreen(viewModel: HandoverViewModel, onDone: () -> Unit) {
    val state by viewModel.uiState.collectAsState()
    var toAddress by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }

    LaunchedEffect(state.done) { if (state.done) onDone() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Propose handover", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(value = toAddress, onValueChange = { toAddress = it }, label = { Text("Recipient address") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = note, onValueChange = { note = it }, label = { Text("Note") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        Button(onClick = { viewModel.proposeTransfer(toAddress, note) }, enabled = !state.submitting) { Text("Propose") }
        Spacer(Modifier.height(16.dp))
        Button(onClick = { viewModel.acceptTransfer() }, enabled = !state.submitting) { Text("Accept pending transfer") }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = { viewModel.cancelTransfer() }, enabled = !state.submitting) { Text("Cancel pending transfer") }
        state.error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error)
        }
    }
}
```

(Drop the unused `ExposedDropdownMenuBox` import if a plain text field
is kept, or wire a real dropdown sourced from `state.recipients` — either
is acceptable; the test only covers the ViewModel.)

- [ ] **Step 7: Wire into NavGraph and update LotScreen's Actions tab**

Modify `NavGraph.kt` to add a `composable(Routes.HANDOVER, ...)` entry analogous to Task 6 Step 7,
and update the `onOpenHandover` lambda passed to `LotScreen` in `LotScreen`'s call site to
`navController.navigate(Routes.handover(id))`.

- [ ] **Step 8: Commit**

```bash
git add terravane/android
git commit -m "Add Handover screen: propose, accept, cancel custody transfer"
```

---

### Task 8: Register produce screen

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/register/RegisterViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/register/RegisterScreen.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/register/RegisterViewModelTest.kt`

**Interfaces:**
- Consumes: `TerravaneRepository.harvest(HarvestRequestDto)` (Task 2); `SettingsStore.selectedParticipantFlow`.
- Produces: `RegisterUiState(submitting: Boolean, error: String?, createdBatchId: Int?)`, `RegisterViewModel(repository, settingsStore)` with `fun submit(produceType: String, variety: String, quantity: String, unit: String, coldChainRequired: Boolean, minTempC: Double, maxTempC: Double)`. On success, `onOpenLot(createdBatchId)` navigates to Task 6's Lot screen.

- [ ] **Step 1: Write the failing ViewModel test**

`terravane/android/app/src/test/java/com/terravane/app/ui/register/RegisterViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.register

import app.cash.turbine.test
import com.terravane.app.data.dto.ActionResultDto
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class RegisterViewModelTest {
    @Test
    fun `submit stores created batch id on success`() = runTest {
        val fakeRepo = FakeTerravaneRepository(harvestResult = Result.success(ActionResultDto(batchId = 15)))
        val viewModel = RegisterViewModel(fakeRepo, FakeSettingsStore(selectedParticipant = "0xabc"))

        viewModel.submit(
            produceType = "Rice", variety = "Basmati", quantity = "500", unit = "kg",
            coldChainRequired = false, minTempC = 0.0, maxTempC = 0.0
        )

        viewModel.uiState.test {
            val state = awaitItem()
            assertEquals(15, state.createdBatchId)
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails, then write and pass**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.register.RegisterViewModelTest"`
Expected: FAIL, then PASS after Step 3.

- [ ] **Step 3: Write the ViewModel**

`terravane/android/app/src/main/java/com/terravane/app/ui/register/RegisterViewModel.kt`:
```kotlin
package com.terravane.app.ui.register

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.SettingsStore
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.dto.HarvestRequestDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class RegisterUiState(
    val submitting: Boolean = false,
    val error: String? = null,
    val createdBatchId: Int? = null
)

class RegisterViewModel(
    private val repository: TerravaneRepository,
    private val settingsStore: SettingsStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(RegisterUiState())
    val uiState: StateFlow<RegisterUiState> = _uiState.asStateFlow()

    fun submit(
        produceType: String,
        variety: String,
        quantity: String,
        unit: String,
        coldChainRequired: Boolean,
        minTempC: Double,
        maxTempC: Double
    ) {
        viewModelScope.launch {
            val me = settingsStore.selectedParticipantFlow.first() ?: return@launch
            _uiState.value = _uiState.value.copy(submitting = true, error = null)
            repository.harvest(
                HarvestRequestDto(
                    `as` = me, produceType = produceType, variety = variety, quantity = quantity,
                    unit = unit, coldChainRequired = coldChainRequired, minTempC = minTempC, maxTempC = maxTempC
                )
            ).fold(
                onSuccess = { _uiState.value = _uiState.value.copy(submitting = false, createdBatchId = it.batchId) },
                onFailure = { _uiState.value = _uiState.value.copy(submitting = false, error = it.message) }
            )
        }
    }
}
```

- [ ] **Step 4: Write the screen**

`terravane/android/app/src/main/java/com/terravane/app/ui/register/RegisterScreen.kt`:
```kotlin
package com.terravane.app.ui.register

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun RegisterScreen(viewModel: RegisterViewModel, onCreated: (Int) -> Unit) {
    val state by viewModel.uiState.collectAsState()
    var produceType by remember { mutableStateOf("") }
    var variety by remember { mutableStateOf("") }
    var quantity by remember { mutableStateOf("") }
    var unit by remember { mutableStateOf("kg") }
    var coldChain by remember { mutableStateOf(false) }
    var minTemp by remember { mutableStateOf("0") }
    var maxTemp by remember { mutableStateOf("0") }

    LaunchedEffect(state.createdBatchId) { state.createdBatchId?.let(onCreated) }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Register produce", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(produceType, { produceType = it }, label = { Text("Produce type") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(variety, { variety = it }, label = { Text("Variety") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(quantity, { quantity = it }, label = { Text("Quantity") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(unit, { unit = it }, label = { Text("Unit") }, modifier = Modifier.fillMaxWidth())
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Checkbox(checked = coldChain, onCheckedChange = { coldChain = it })
            Text("Cold chain required")
        }
        if (coldChain) {
            OutlinedTextField(minTemp, { minTemp = it }, label = { Text("Min °C") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(maxTemp, { maxTemp = it }, label = { Text("Max °C") }, modifier = Modifier.fillMaxWidth())
        }
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = {
                viewModel.submit(produceType, variety, quantity, unit, coldChain, minTemp.toDoubleOrNull() ?: 0.0, maxTemp.toDoubleOrNull() ?: 0.0)
            },
            enabled = !state.submitting
        ) { Text("Register") }
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}
```

- [ ] **Step 5: Wire into NavGraph**

Add `composable(Routes.REGISTER) { RegisterScreen(registerViewModel) { id -> navController.navigate(Routes.lot(id)) } }`
to `NavGraph.kt`, with `registerViewModel: RegisterViewModel` added to `TerravaneNavGraph`'s parameters.

- [ ] **Step 6: Commit**

```bash
git add terravane/android
git commit -m "Add Register produce screen"
```

---

### Task 9: Inspect produce screen

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/inspect/InspectViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/inspect/InspectScreen.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/inspect/InspectViewModelTest.kt`

**Interfaces:**
- Consumes: `TerravaneRepository.inspect(id, InspectRequestDto)` (Task 2); `SettingsStore.selectedParticipantFlow`.
- Produces: `InspectUiState(submitting: Boolean, error: String?, done: Boolean)`, `InspectViewModel(repository, settingsStore, batchId: Int)` with `fun submit(grade: Int, passed: Boolean, findings: String)`.

- [ ] **Step 1: Write the failing ViewModel test**

`terravane/android/app/src/test/java/com/terravane/app/ui/inspect/InspectViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.inspect

import app.cash.turbine.test
import com.terravane.app.data.dto.ActionResultDto
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertTrue
import org.junit.Test

class InspectViewModelTest {
    @Test
    fun `submit marks done on success`() = runTest {
        val fakeRepo = FakeTerravaneRepository(inspectResult = Result.success(ActionResultDto()))
        val viewModel = InspectViewModel(fakeRepo, FakeSettingsStore(selectedParticipant = "0xabc"), batchId = 9)

        viewModel.submit(grade = 88, passed = true, findings = "meets grade A")

        viewModel.uiState.test {
            assertTrue(awaitItem().done)
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails, then write and pass**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.inspect.InspectViewModelTest"`

`terravane/android/app/src/main/java/com/terravane/app/ui/inspect/InspectViewModel.kt`:
```kotlin
package com.terravane.app.ui.inspect

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.SettingsStore
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.dto.InspectRequestDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class InspectUiState(val submitting: Boolean = false, val error: String? = null, val done: Boolean = false)

class InspectViewModel(
    private val repository: TerravaneRepository,
    private val settingsStore: SettingsStore,
    private val batchId: Int
) : ViewModel() {

    private val _uiState = MutableStateFlow(InspectUiState())
    val uiState: StateFlow<InspectUiState> = _uiState.asStateFlow()

    fun submit(grade: Int, passed: Boolean, findings: String) {
        viewModelScope.launch {
            val me = settingsStore.selectedParticipantFlow.first() ?: return@launch
            _uiState.value = _uiState.value.copy(submitting = true, error = null)
            repository.inspect(batchId, InspectRequestDto(`as` = me, grade = grade, passed = passed, findings = findings)).fold(
                onSuccess = { _uiState.value = _uiState.value.copy(submitting = false, done = true) },
                onFailure = { _uiState.value = _uiState.value.copy(submitting = false, error = it.message) }
            )
        }
    }
}
```

Expected: FAIL before this file exists, PASS after.

- [ ] **Step 3: Write the screen**

`terravane/android/app/src/main/java/com/terravane/app/ui/inspect/InspectScreen.kt`:
```kotlin
package com.terravane.app.ui.inspect

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun InspectScreen(viewModel: InspectViewModel, onDone: () -> Unit) {
    val state by viewModel.uiState.collectAsState()
    var grade by remember { mutableStateOf("") }
    var passed by remember { mutableStateOf(true) }
    var findings by remember { mutableStateOf("") }

    LaunchedEffect(state.done) { if (state.done) onDone() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Inspect produce", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(grade, { grade = it }, label = { Text("Grade (0-100)") }, modifier = Modifier.fillMaxWidth())
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Checkbox(checked = passed, onCheckedChange = { passed = it })
            Text("Passed")
        }
        OutlinedTextField(findings, { findings = it }, label = { Text("Findings") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        Button(onClick = { viewModel.submit(grade.toIntOrNull() ?: 0, passed, findings) }, enabled = !state.submitting) {
            Text("Submit inspection")
        }
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    }
}
```

- [ ] **Step 4: Wire into NavGraph with an `Int` argument (pattern from Task 6 Step 7) and commit**

```bash
git add terravane/android
git commit -m "Add Inspect produce screen"
```

---

### Task 10: Inventory and Global search screens

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/inventory/InventoryViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/inventory/InventoryScreen.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/search/SearchViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/search/SearchScreen.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/inventory/InventoryViewModelTest.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/search/SearchViewModelTest.kt`

**Interfaces:**
- Consumes: `TerravaneRepository.batches(q, stage, flag)` (Task 2).
- Produces: `InventoryViewModel(repository, settingsStore)` filters to the signed-in participant's custody by default, exposing `uiState: StateFlow<List<BatchDto>>` plus `fun setFlagFilter(flag: String?)`. `SearchViewModel(repository)` exposes `fun search(query: String)` and `uiState: StateFlow<List<BatchDto>>`, unfiltered by participant. Both screens reuse a shared `BatchRow` composable (added to `ui/common/BatchRow.kt` in this task) that Task 5's Dashboard could adopt later but is not retrofitted here (YAGNI — dashboard's inline rows stay as-is).

- [ ] **Step 1: Write the failing tests**

`terravane/android/app/src/test/java/com/terravane/app/ui/inventory/InventoryViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.inventory

import app.cash.turbine.test
import com.terravane.app.data.dto.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class InventoryViewModelTest {
    @Test
    fun `loads only batches held by the signed-in participant`() = runTest {
        val mine = sampleBatch(id = 1, custodian = "0xabc")
        val other = sampleBatch(id = 2, custodian = "0xdef")
        val fakeRepo = FakeTerravaneRepository(batchesResult = Result.success(listOf(mine, other)))
        val viewModel = InventoryViewModel(fakeRepo, FakeSettingsStore(selectedParticipant = "0xabc"))

        viewModel.uiState.test {
            awaitItem() // initial empty
            val loaded = awaitItem()
            assertEquals(listOf(1), loaded.map { it.id })
        }
    }
}

private fun sampleBatch(id: Int, custodian: String) = BatchDto(
    id = id, produceType = "Rice", variety = null, quantity = "1", soldQuantity = "0", unit = "kg",
    stage = 0, stageName = "Harvested", recalled = false, coldChainRequired = false, coldChainBreached = false,
    tempWindow = null, harvestedAt = 0, createdAt = 0,
    origin = OriginDto(null, null, null, null, null),
    custodian = ParticipantDto(custodian, "x", null, emptyList(), true, null, null),
    pendingCustodian = null, metadataURI = null, metadataHash = null,
    counts = CountsDto(0, 0, 0, 0, 0, 0), custodyIntact = true, parents = emptyList(), children = emptyList()
)
```

`terravane/android/app/src/test/java/com/terravane/app/ui/search/SearchViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.search

import app.cash.turbine.test
import com.terravane.app.data.dto.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchViewModelTest {
    @Test
    fun `search populates results from the repository`() = runTest {
        val fakeRepo = FakeTerravaneRepository(
            batchesResult = Result.success(listOf(
                BatchDto(
                    id = 3, produceType = "Mango", variety = null, quantity = "1", soldQuantity = "0", unit = "kg",
                    stage = 0, stageName = "Harvested", recalled = false, coldChainRequired = false, coldChainBreached = false,
                    tempWindow = null, harvestedAt = 0, createdAt = 0,
                    origin = OriginDto(null, null, null, null, null), custodian = null, pendingCustodian = null,
                    metadataURI = null, metadataHash = null,
                    counts = CountsDto(0, 0, 0, 0, 0, 0), custodyIntact = true, parents = emptyList(), children = emptyList()
                )
            ))
        )
        val viewModel = SearchViewModel(fakeRepo)

        viewModel.search("mango")

        viewModel.uiState.test {
            assertEquals(listOf(3), awaitItem().map { it.id })
        }
    }
}
```

- [ ] **Step 2: Run both to verify they fail**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.inventory.InventoryViewModelTest" --tests "com.terravane.app.ui.search.SearchViewModelTest"`
Expected: FAIL (types unresolved).

- [ ] **Step 3: Write both ViewModels**

`terravane/android/app/src/main/java/com/terravane/app/ui/inventory/InventoryViewModel.kt`:
```kotlin
package com.terravane.app.ui.inventory

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.SettingsStore
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.dto.BatchDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class InventoryViewModel(
    private val repository: TerravaneRepository,
    private val settingsStore: SettingsStore
) : ViewModel() {

    private val _uiState = MutableStateFlow<List<BatchDto>>(emptyList())
    val uiState: StateFlow<List<BatchDto>> = _uiState.asStateFlow()

    init { load(null) }

    fun setFlagFilter(flag: String?) = load(flag)

    private fun load(flag: String?) {
        viewModelScope.launch {
            val me = settingsStore.selectedParticipantFlow.first() ?: return@launch
            repository.batches(flag = flag).onSuccess { list ->
                _uiState.value = list.filter { it.custodian?.address.equals(me, ignoreCase = true) }
            }
        }
    }
}
```

`terravane/android/app/src/main/java/com/terravane/app/ui/search/SearchViewModel.kt`:
```kotlin
package com.terravane.app.ui.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.dto.BatchDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class SearchViewModel(private val repository: TerravaneRepository) : ViewModel() {

    private val _uiState = MutableStateFlow<List<BatchDto>>(emptyList())
    val uiState: StateFlow<List<BatchDto>> = _uiState.asStateFlow()

    fun search(query: String) {
        viewModelScope.launch {
            repository.batches(q = query).onSuccess { _uiState.value = it }
        }
    }
}
```

- [ ] **Step 4: Run both to verify they pass**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.inventory.InventoryViewModelTest" --tests "com.terravane.app.ui.search.SearchViewModelTest"`
Expected: PASS.

- [ ] **Step 5: Write the shared row and both screens**

`terravane/android/app/src/main/java/com/terravane/app/ui/common/BatchRow.kt`:
```kotlin
package com.terravane.app.ui.common

import androidx.compose.foundation.clickable
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.terravane.app.data.dto.BatchDto

@Composable
fun BatchRow(batch: BatchDto, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text("Lot #${batch.id} — ${batch.produceType}") },
        supportingContent = { Text("${batch.stageName}${if (batch.recalled) " — RECALLED" else ""}") },
        modifier = Modifier.clickable(onClick = onClick)
    )
}
```

`terravane/android/app/src/main/java/com/terravane/app/ui/inventory/InventoryScreen.kt`:
```kotlin
package com.terravane.app.ui.inventory

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.terravane.app.ui.common.BatchRow

@Composable
fun InventoryScreen(viewModel: InventoryViewModel, onOpenLot: (Int) -> Unit) {
    val batches by viewModel.uiState.collectAsState()
    LazyColumn(Modifier.fillMaxSize()) {
        items(batches) { batch -> BatchRow(batch) { onOpenLot(batch.id) } }
    }
}
```

`terravane/android/app/src/main/java/com/terravane/app/ui/search/SearchScreen.kt`:
```kotlin
package com.terravane.app.ui.search

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.terravane.app.ui.common.BatchRow

@Composable
fun SearchScreen(viewModel: SearchViewModel, onOpenLot: (Int) -> Unit) {
    val results by viewModel.uiState.collectAsState()
    var query by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it; viewModel.search(it) },
            modifier = Modifier.fillMaxWidth()
        )
        LazyColumn {
            items(results) { batch -> BatchRow(batch) { onOpenLot(batch.id) } }
        }
    }
}
```

- [ ] **Step 6: Wire both into NavGraph and commit**

```bash
git add terravane/android
git commit -m "Add Inventory and Global search screens"
```

---

### Task 11: Notifications screen

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/notifications/NotificationsViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/notifications/NotificationsScreen.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/notifications/NotificationsViewModelTest.kt`

**Interfaces:**
- Consumes: `TerravaneRepository.notifications(as)` (Task 2); `SettingsStore.selectedParticipantFlow`.
- Produces: `NotificationsViewModel(repository, settingsStore)` exposing `uiState: StateFlow<List<NotificationDto>>` and `fun refresh()`.

- [ ] **Step 1: Write the failing test**

`terravane/android/app/src/test/java/com/terravane/app/ui/notifications/NotificationsViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.notifications

import app.cash.turbine.test
import com.terravane.app.data.dto.NotificationDto
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationsViewModelTest {
    @Test
    fun `loads notifications for the signed-in participant`() = runTest {
        val notification = NotificationDto(
            name = "RecallInitiated", batchId = 4, actor = null, at = 0, txHash = null,
            args = JsonObject(emptyMap()), mine = false
        )
        val fakeRepo = FakeTerravaneRepository(notificationsResult = Result.success(listOf(notification)))
        val viewModel = NotificationsViewModel(fakeRepo, FakeSettingsStore(selectedParticipant = "0xabc"))

        viewModel.uiState.test {
            awaitItem() // initial empty
            assertEquals(1, awaitItem().size)
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails, then write and pass**

`terravane/android/app/src/main/java/com/terravane/app/ui/notifications/NotificationsViewModel.kt`:
```kotlin
package com.terravane.app.ui.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.SettingsStore
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.dto.NotificationDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class NotificationsViewModel(
    private val repository: TerravaneRepository,
    private val settingsStore: SettingsStore
) : ViewModel() {

    private val _uiState = MutableStateFlow<List<NotificationDto>>(emptyList())
    val uiState: StateFlow<List<NotificationDto>> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            val me = settingsStore.selectedParticipantFlow.first() ?: return@launch
            repository.notifications(me).onSuccess { _uiState.value = it }
        }
    }
}
```

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.notifications.NotificationsViewModelTest"`
Expected: FAIL before this file exists, PASS after.

- [ ] **Step 3: Write the screen**

`terravane/android/app/src/main/java/com/terravane/app/ui/notifications/NotificationsScreen.kt`:
```kotlin
package com.terravane.app.ui.notifications

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier

@Composable
fun NotificationsScreen(viewModel: NotificationsViewModel, onOpenLot: (Int) -> Unit) {
    val notifications by viewModel.uiState.collectAsState()
    LazyColumn(Modifier.fillMaxSize()) {
        items(notifications) { n ->
            ListItem(
                headlineContent = { Text(n.name) },
                supportingContent = { Text("Lot #${n.batchId}") },
                modifier = Modifier.clickable { onOpenLot(n.batchId) }
            )
        }
    }
}
```

- [ ] **Step 4: Wire into NavGraph and commit**

```bash
git add terravane/android
git commit -m "Add Notifications screen"
```

---

### Task 12: Regulator view (admin)

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/regulator/RegulatorViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/regulator/RegulatorScreen.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/regulator/RegulatorViewModelTest.kt`

**Interfaces:**
- Consumes: `TerravaneRepository.batches(flag = "recalled")`, `.batches(flag = "breached")` (Task 2) — the web `regulator.html` view derives its region tables client-side from the same flagged-batch lists the server already exposes, so no new endpoint is needed.
- Produces: `RegulatorUiState(recalled: List<BatchDto>, breached: List<BatchDto>, loading: Boolean)`, `RegulatorViewModel(repository)` exposing `uiState: StateFlow<RegulatorUiState>`, grouped by `batch.origin.location` for the region tables.

- [ ] **Step 1: Write the failing test**

`terravane/android/app/src/test/java/com/terravane/app/ui/regulator/RegulatorViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.regulator

import app.cash.turbine.test
import com.terravane.app.data.dto.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class RegulatorViewModelTest {
    @Test
    fun `loads recalled and breached batches separately`() = runTest {
        val recalled = sample(id = 1)
        val breached = sample(id = 2)
        val fakeRepo = FakeTerravaneRepository(
            batchesByFlag = mapOf("recalled" to Result.success(listOf(recalled)), "breached" to Result.success(listOf(breached)))
        )
        val viewModel = RegulatorViewModel(fakeRepo)

        viewModel.uiState.test {
            awaitItem() // initial loading
            val loaded = awaitItem()
            assertEquals(listOf(1), loaded.recalled.map { it.id })
            assertEquals(listOf(2), loaded.breached.map { it.id })
        }
    }
}

private fun sample(id: Int) = BatchDto(
    id = id, produceType = "Tea", variety = null, quantity = "1", soldQuantity = "0", unit = "kg",
    stage = 0, stageName = "Harvested", recalled = false, coldChainRequired = false, coldChainBreached = false,
    tempWindow = null, harvestedAt = 0, createdAt = 0,
    origin = OriginDto(null, "Nilgiri", null, null, null), custodian = null, pendingCustodian = null,
    metadataURI = null, metadataHash = null,
    counts = CountsDto(0, 0, 0, 0, 0, 0), custodyIntact = true, parents = emptyList(), children = emptyList()
)
```

(`FakeTerravaneRepository.batchesResult` alone can't distinguish two
different flags in one test, so add an optional `batchesByFlag: Map<String,
Result<List<BatchDto>>>` constructor param to the shared fake — when
present, `batches(flag = ...)` looks up that map by flag instead of
returning the single `batchesResult`.)

- [ ] **Step 2: Run to verify it fails, then write and pass**

`terravane/android/app/src/main/java/com/terravane/app/ui/regulator/RegulatorViewModel.kt`:
```kotlin
package com.terravane.app.ui.regulator

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.dto.BatchDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class RegulatorUiState(
    val recalled: List<BatchDto> = emptyList(),
    val breached: List<BatchDto> = emptyList(),
    val loading: Boolean = true
)

class RegulatorViewModel(private val repository: TerravaneRepository) : ViewModel() {

    private val _uiState = MutableStateFlow(RegulatorUiState())
    val uiState: StateFlow<RegulatorUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val recalled = repository.batches(flag = "recalled").getOrDefault(emptyList())
            val breached = repository.batches(flag = "breached").getOrDefault(emptyList())
            _uiState.value = RegulatorUiState(recalled, breached, loading = false)
        }
    }
}
```

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.regulator.RegulatorViewModelTest"`
Expected: FAIL before this file exists, PASS after.

- [ ] **Step 3: Write the screen**

`terravane/android/app/src/main/java/com/terravane/app/ui/regulator/RegulatorScreen.kt`:
```kotlin
package com.terravane.app.ui.regulator

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.terravane.app.ui.common.BatchRow

@Composable
fun RegulatorScreen(viewModel: RegulatorViewModel, onOpenLot: (Int) -> Unit) {
    val state by viewModel.uiState.collectAsState()
    val byRegionRecalled = state.recalled.groupBy { it.origin.location ?: "Unknown" }
    val byRegionBreached = state.breached.groupBy { it.origin.location ?: "Unknown" }

    LazyColumn(Modifier.fillMaxSize()) {
        item { Text("Recalls by region") }
        byRegionRecalled.forEach { (region, batches) ->
            item { Text("$region (${batches.size})") }
            items(batches) { BatchRow(it) { id -> onOpenLot(id) } }
        }
        item { Text("Cold-chain breaches by region") }
        byRegionBreached.forEach { (region, batches) ->
            item { Text("$region (${batches.size})") }
            items(batches) { BatchRow(it) { id -> onOpenLot(id) } }
        }
    }
}
```

- [ ] **Step 4: Wire into NavGraph and commit**

```bash
git add terravane/android
git commit -m "Add Regulator view with recall/breach-by-region tables"
```

---

### Task 13: Consumer trace — QR scan + trace result screen

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/trace/TraceViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/trace/TraceScanScreen.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/trace/TraceResultScreen.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/trace/QrAnalyzer.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/trace/TraceViewModelTest.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/trace/QrAnalyzerTest.kt`

**Interfaces:**
- Consumes: `TerravaneRepository.trace(id)` (Task 2).
- Produces: `TraceViewModel(repository)` with `fun load(id: Int)` and `uiState: StateFlow<TraceUiState>` (`TraceUiState(trace: TraceDto?, loading: Boolean, error: String?)`). `QrAnalyzer.extractBatchId(scannedText: String): Int?` — parses the `?id=<n>` query param out of the URL encoded in the QR (matching `/api/qr/:id`'s `trace.html?id=<n>` payload), pure function, independently testable without a camera.

- [ ] **Step 1: Write the failing QR-parsing test (pure function, no camera needed)**

`terravane/android/app/src/test/java/com/terravane/app/ui/trace/QrAnalyzerTest.kt`:
```kotlin
package com.terravane.app.ui.trace

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QrAnalyzerTest {
    @Test
    fun `extracts batch id from a trace URL`() {
        assertEquals(42, QrAnalyzer.extractBatchId("https://terravane.onrender.com/trace.html?id=42"))
    }

    @Test
    fun `returns null for unrelated text`() {
        assertNull(QrAnalyzer.extractBatchId("not a terravane url"))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.trace.QrAnalyzerTest"`
Expected: FAIL (`QrAnalyzer` unresolved).

- [ ] **Step 3: Write QrAnalyzer**

`terravane/android/app/src/main/java/com/terravane/app/ui/trace/QrAnalyzer.kt`:
```kotlin
package com.terravane.app.ui.trace

import android.net.Uri

object QrAnalyzer {
    fun extractBatchId(scannedText: String): Int? =
        runCatching { Uri.parse(scannedText).getQueryParameter("id")?.toIntOrNull() }.getOrNull()
}
```

Note: `android.net.Uri` is not available in plain JUnit tests unless
Robolectric is added; to keep this a fast pure-JVM test, replace the
`Uri.parse` call with a small hand-rolled regex instead:
```kotlin
package com.terravane.app.ui.trace

object QrAnalyzer {
    private val idPattern = Regex("""[?&]id=(\d+)""")

    fun extractBatchId(scannedText: String): Int? =
        idPattern.find(scannedText)?.groupValues?.get(1)?.toIntOrNull()
}
```
Use this regex-based version — it needs no Android framework class and
runs under plain JUnit.

- [ ] **Step 4: Run to verify it passes**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.trace.QrAnalyzerTest"`
Expected: PASS.

- [ ] **Step 5: Write the failing TraceViewModel test**

`terravane/android/app/src/test/java/com/terravane/app/ui/trace/TraceViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.trace

import app.cash.turbine.test
import com.terravane.app.data.dto.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class TraceViewModelTest {
    @Test
    fun `load populates the trace result`() = runTest {
        val batch = BatchDto(
            id = 42, produceType = "Tea", variety = null, quantity = "1", soldQuantity = "0", unit = "kg",
            stage = 0, stageName = "Harvested", recalled = true, coldChainRequired = false, coldChainBreached = false,
            tempWindow = null, harvestedAt = 0, createdAt = 0,
            origin = OriginDto(null, null, null, null, null), custodian = null, pendingCustodian = null,
            metadataURI = null, metadataHash = null,
            counts = CountsDto(0, 0, 0, 0, 0, 0), custodyIntact = true, parents = emptyList(), children = emptyList()
        )
        val trace = TraceDto(
            id = 42, verdict = "unsafe", warnings = listOf(WarningDto("critical", "Recalled")), batch = batch,
            attributes = null, journey = emptyList(), certifications = emptyList(), telemetry = emptyList(),
            lineage = LineageDto(emptyList(), emptyList()), recall = null
        )
        val fakeRepo = FakeTerravaneRepository(traceResult = Result.success(trace))
        val viewModel = TraceViewModel(fakeRepo)

        viewModel.load(42)

        viewModel.uiState.test {
            awaitItem() // loading
            val loaded = awaitItem()
            assertEquals("unsafe", loaded.trace?.verdict)
        }
    }
}
```

- [ ] **Step 6: Run to verify it fails, then write and pass**

`terravane/android/app/src/main/java/com/terravane/app/ui/trace/TraceViewModel.kt`:
```kotlin
package com.terravane.app.ui.trace

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.dto.TraceDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class TraceUiState(val trace: TraceDto? = null, val loading: Boolean = false, val error: String? = null)

class TraceViewModel(private val repository: TerravaneRepository) : ViewModel() {

    private val _uiState = MutableStateFlow(TraceUiState())
    val uiState: StateFlow<TraceUiState> = _uiState.asStateFlow()

    fun load(id: Int) {
        viewModelScope.launch {
            _uiState.value = TraceUiState(loading = true)
            repository.trace(id).fold(
                onSuccess = { _uiState.value = TraceUiState(trace = it, loading = false) },
                onFailure = { _uiState.value = TraceUiState(loading = false, error = it.message) }
            )
        }
    }
}
```

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.trace.TraceViewModelTest"`
Expected: FAIL before this file exists, PASS after.

- [ ] **Step 7: Write the CameraX scan screen**

`terravane/android/app/src/main/java/com/terravane/app/ui/trace/TraceScanScreen.kt`:
```kotlin
package com.terravane.app.ui.trace

import android.Manifest
import android.content.pm.PackageManager
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

@Composable
fun TraceScanScreen(onScanned: (Int) -> Unit) {
    val context = LocalContext.current
    val hasPermission = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    if (!hasPermission) return

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
            val executor = Executors.newSingleThreadExecutor()
            val scanner = BarcodeScanning.getClient()

            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
                val analysis = ImageAnalysis.Builder().build().also {
                    it.setAnalyzer(executor) { imageProxy ->
                        val mediaImage = imageProxy.image
                        if (mediaImage != null) {
                            val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                            scanner.process(image)
                                .addOnSuccessListener { barcodes: List<Barcode> ->
                                    barcodes.firstNotNullOfOrNull { it.rawValue }
                                        ?.let { QrAnalyzer.extractBatchId(it) }
                                        ?.let(onScanned)
                                }
                                .addOnCompleteListener { imageProxy.close() }
                        } else {
                            imageProxy.close()
                        }
                    }
                }
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    ctx as androidx.lifecycle.LifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis
                )
            }, ContextCompat.getMainExecutor(ctx))

            previewView
        }
    )
}
```

- [ ] **Step 8: Write the trace result screen**

`terravane/android/app/src/main/java/com/terravane/app/ui/trace/TraceResultScreen.kt`:
```kotlin
package com.terravane.app.ui.trace

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun TraceResultScreen(viewModel: TraceViewModel, batchId: Int) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(batchId) { viewModel.load(batchId) }

    when {
        state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        state.trace == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Could not load trace: ${state.error}")
        }
        else -> LazyColumn(Modifier.fillMaxSize().padding(16.dp)) {
            item {
                Text("Verdict: ${state.trace!!.verdict}", style = MaterialTheme.typography.headlineSmall)
            }
            items(state.trace!!.warnings) { w -> Text("${w.level}: ${w.text}") }
            item { Text("Lot #${state.trace!!.batch.id} — ${state.trace!!.batch.produceType}") }
            item { Text("Journey", style = MaterialTheme.typography.titleMedium) }
            items(state.trace!!.journey) { step -> Text("${step.label} — ${step.actor ?: ""}") }
        }
    }
}
```

- [ ] **Step 9: Wire both trace routes into NavGraph and commit**

```bash
git add terravane/android
git commit -m "Add consumer QR scan and trace result screens"
```

---

### Task 14: Pack label screen

**Files:**
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/label/LabelViewModel.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/label/LabelScreen.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Test: `terravane/android/app/src/test/java/com/terravane/app/ui/label/LabelViewModelTest.kt`

**Interfaces:**
- Consumes: `TerravaneRepository.batch(id)` (Task 2); server's `/api/qr/{id}` SVG endpoint, loaded directly by Coil in the screen (no repository wrapper needed — it's a raw image URL, not JSON).
- Produces: `LabelViewModel(repository, baseUrl: String)` exposing `uiState: StateFlow<LabelUiState>` (`LabelUiState(dossier: DossierDto?, qrUrl: String?, loading: Boolean)`).

- [ ] **Step 1: Write the failing test**

`terravane/android/app/src/test/java/com/terravane/app/ui/label/LabelViewModelTest.kt`:
```kotlin
package com.terravane.app.ui.label

import app.cash.turbine.test
import com.terravane.app.data.dto.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class LabelViewModelTest {
    @Test
    fun `builds the qr url from the base url and batch id`() = runTest {
        val batch = BatchDto(
            id = 7, produceType = "Wheat", variety = null, quantity = "1", soldQuantity = "0", unit = "kg",
            stage = 0, stageName = "Harvested", recalled = false, coldChainRequired = false, coldChainBreached = false,
            tempWindow = null, harvestedAt = 0, createdAt = 0,
            origin = OriginDto(null, null, null, null, null), custodian = null, pendingCustodian = null,
            metadataURI = null, metadataHash = null,
            counts = CountsDto(0, 0, 0, 0, 0, 0), custodyIntact = true, parents = emptyList(), children = emptyList()
        )
        val dossier = DossierDto(batch, null, emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), null)
        val fakeRepo = FakeTerravaneRepository(batchResult = Result.success(dossier))
        val viewModel = LabelViewModel(fakeRepo, baseUrl = "https://terravane.onrender.com/")

        viewModel.load(7)

        viewModel.uiState.test {
            awaitItem() // loading
            val loaded = awaitItem()
            assertEquals("https://terravane.onrender.com/api/qr/7", loaded.qrUrl)
        }
    }
}
```

- [ ] **Step 2: Run to verify it fails, then write and pass**

`terravane/android/app/src/main/java/com/terravane/app/ui/label/LabelViewModel.kt`:
```kotlin
package com.terravane.app.ui.label

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.terravane.app.data.TerravaneRepository
import com.terravane.app.data.dto.DossierDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class LabelUiState(val dossier: DossierDto? = null, val qrUrl: String? = null, val loading: Boolean = true)

class LabelViewModel(
    private val repository: TerravaneRepository,
    private val baseUrl: String
) : ViewModel() {

    private val _uiState = MutableStateFlow(LabelUiState())
    val uiState: StateFlow<LabelUiState> = _uiState.asStateFlow()

    fun load(id: Int) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true)
            val normalized = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
            val dossier = repository.batch(id).getOrNull()
            _uiState.value = LabelUiState(dossier = dossier, qrUrl = "${normalized}api/qr/$id", loading = false)
        }
    }
}
```

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest --tests "com.terravane.app.ui.label.LabelViewModelTest"`
Expected: FAIL before this file exists, PASS after.

- [ ] **Step 3: Write the screen using Coil's SVG decoder for the QR**

`terravane/android/app/src/main/java/com/terravane/app/ui/label/LabelScreen.kt`:
```kotlin
package com.terravane.app.ui.label

import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage

@Composable
fun LabelScreen(viewModel: LabelViewModel, batchId: Int) {
    val state by viewModel.uiState.collectAsState()
    LaunchedEffect(batchId) { viewModel.load(batchId) }

    Column(Modifier.fillMaxSize().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (state.loading) {
            CircularProgressIndicator()
        } else {
            state.dossier?.let { d ->
                Text("Lot #${d.batch.id} — ${d.batch.produceType}")
                Text("Origin: ${d.batch.origin.location ?: "unknown"}")
                Text("Harvested: ${d.batch.harvestedAt}")
            }
            state.qrUrl?.let { url ->
                AsyncImage(model = url, contentDescription = "QR code", modifier = Modifier.size(200.dp))
            }
        }
    }
}
```

- [ ] **Step 4: Wire into NavGraph and commit**

```bash
git add terravane/android
git commit -m "Add Pack label screen with QR code"
```

---

### Task 15: Final ViewModel wiring, bottom navigation, and localization

**Files:**
- Modify: `terravane/android/app/src/main/java/com/terravane/app/MainActivity.kt`
- Modify: `terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt`
- Create: `terravane/android/app/src/main/java/com/terravane/app/ui/common/AppScaffold.kt`
- Create: `terravane/android/app/src/main/res/values/strings.xml`
- Create: `terravane/android/app/src/main/res/values-hi/strings.xml`

**Interfaces:**
- Consumes: every ViewModel from Tasks 3-14, `TerravaneApp.repository`/`settingsStore` (Task 2).
- Produces: fully wired app — `MainActivity` builds every ViewModel via a single `ViewModelProvider.Factory` (`TerravaneViewModelFactory`) and passes them into `TerravaneNavGraph`. This is the task where all the "wired in a later task" notes from Tasks 4-14 get resolved into one real `NavHost`.

- [ ] **Step 1: Write the ViewModel factory**

`terravane/android/app/src/main/java/com/terravane/app/MainActivity.kt` (full rewrite):
```kotlin
package com.terravane.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.CreationExtras
import com.terravane.app.ui.dashboard.DashboardViewModel
import com.terravane.app.ui.handover.HandoverViewModel
import com.terravane.app.ui.inspect.InspectViewModel
import com.terravane.app.ui.inventory.InventoryViewModel
import com.terravane.app.ui.label.LabelViewModel
import com.terravane.app.ui.lot.LotViewModel
import com.terravane.app.ui.nav.TerravaneNavGraph
import com.terravane.app.ui.notifications.NotificationsViewModel
import com.terravane.app.ui.regulator.RegulatorViewModel
import com.terravane.app.ui.register.RegisterViewModel
import com.terravane.app.ui.search.SearchViewModel
import com.terravane.app.ui.settings.SettingsViewModel
import com.terravane.app.ui.signin.SignInViewModel
import com.terravane.app.ui.theme.TerravaneTheme
import com.terravane.app.ui.trace.TraceViewModel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as TerravaneApp
        val currentBaseUrl = runBlocking { app.settingsStore.baseUrlFlow.first() }

        setContent {
            TerravaneTheme {
                TerravaneNavGraph(
                    signInViewModel = SignInViewModel(app.repository, app.settingsStore),
                    dashboardViewModel = DashboardViewModel(app.repository, app.settingsStore),
                    settingsViewModel = SettingsViewModel(app.settingsStore) { app.rebuildRepository(it) },
                    registerViewModel = RegisterViewModel(app.repository, app.settingsStore),
                    inventoryViewModel = InventoryViewModel(app.repository, app.settingsStore),
                    searchViewModel = SearchViewModel(app.repository),
                    notificationsViewModel = NotificationsViewModel(app.repository, app.settingsStore),
                    regulatorViewModel = RegulatorViewModel(app.repository),
                    traceViewModel = TraceViewModel(app.repository),
                    lotViewModelFactory = { id -> LotViewModel(app.repository, id) },
                    handoverViewModelFactory = { id -> HandoverViewModel(app.repository, app.settingsStore, id) },
                    inspectViewModelFactory = { id -> InspectViewModel(app.repository, app.settingsStore, id) },
                    labelViewModelFactory = { id -> LabelViewModel(app.repository, currentBaseUrl).also { it.load(id) } }
                )
            }
        }
    }
}
```

- [ ] **Step 2: Rewrite NavGraph to take every ViewModel/factory and wire all routes**

`terravane/android/app/src/main/java/com/terravane/app/ui/nav/NavGraph.kt` (full rewrite, consolidating
every `composable(...)` block written incrementally in Tasks 4-14):
```kotlin
package com.terravane.app.ui.nav

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.terravane.app.ui.dashboard.DashboardScreen
import com.terravane.app.ui.dashboard.DashboardViewModel
import com.terravane.app.ui.handover.HandoverScreen
import com.terravane.app.ui.handover.HandoverViewModel
import com.terravane.app.ui.inspect.InspectScreen
import com.terravane.app.ui.inspect.InspectViewModel
import com.terravane.app.ui.inventory.InventoryScreen
import com.terravane.app.ui.inventory.InventoryViewModel
import com.terravane.app.ui.label.LabelScreen
import com.terravane.app.ui.label.LabelViewModel
import com.terravane.app.ui.lot.LotScreen
import com.terravane.app.ui.lot.LotViewModel
import com.terravane.app.ui.notifications.NotificationsScreen
import com.terravane.app.ui.notifications.NotificationsViewModel
import com.terravane.app.ui.regulator.RegulatorScreen
import com.terravane.app.ui.regulator.RegulatorViewModel
import com.terravane.app.ui.register.RegisterScreen
import com.terravane.app.ui.register.RegisterViewModel
import com.terravane.app.ui.search.SearchScreen
import com.terravane.app.ui.search.SearchViewModel
import com.terravane.app.ui.settings.SettingsScreen
import com.terravane.app.ui.settings.SettingsViewModel
import com.terravane.app.ui.signin.SignInScreen
import com.terravane.app.ui.signin.SignInViewModel
import com.terravane.app.ui.trace.TraceResultScreen
import com.terravane.app.ui.trace.TraceScanScreen
import com.terravane.app.ui.trace.TraceViewModel

@Composable
fun TerravaneNavGraph(
    navController: NavHostController = rememberNavController(),
    signInViewModel: SignInViewModel,
    dashboardViewModel: DashboardViewModel,
    settingsViewModel: SettingsViewModel,
    registerViewModel: RegisterViewModel,
    inventoryViewModel: InventoryViewModel,
    searchViewModel: SearchViewModel,
    notificationsViewModel: NotificationsViewModel,
    regulatorViewModel: RegulatorViewModel,
    traceViewModel: TraceViewModel,
    lotViewModelFactory: (Int) -> LotViewModel,
    handoverViewModelFactory: (Int) -> HandoverViewModel,
    inspectViewModelFactory: (Int) -> InspectViewModel,
    labelViewModelFactory: (Int) -> LabelViewModel
) {
    NavHost(navController = navController, startDestination = Routes.SIGN_IN) {
        composable(Routes.SIGN_IN) {
            SignInScreen(signInViewModel) {
                navController.navigate(Routes.DASHBOARD) { popUpTo(Routes.SIGN_IN) { inclusive = true } }
            }
        }
        composable(Routes.DASHBOARD) {
            DashboardScreen(
                viewModel = dashboardViewModel,
                onOpenLot = { id -> navController.navigate(Routes.lot(id)) },
                onOpenNotifications = { navController.navigate(Routes.NOTIFICATIONS) },
                onOpenInventory = { navController.navigate(Routes.INVENTORY) },
                onOpenSearch = { navController.navigate(Routes.SEARCH) },
                onOpenRegister = { navController.navigate(Routes.REGISTER) }
            )
        }
        composable(Routes.LOT, arguments = listOf(navArgument("id") { type = NavType.IntType })) { entry ->
            val id = entry.arguments!!.getInt("id")
            LotScreen(
                viewModel = lotViewModelFactory(id),
                onOpenLot = { childId -> navController.navigate(Routes.lot(childId)) },
                onOpenHandover = { navController.navigate(Routes.handover(id)) }
            )
        }
        composable(Routes.HANDOVER, arguments = listOf(navArgument("id") { type = NavType.IntType })) { entry ->
            val id = entry.arguments!!.getInt("id")
            HandoverScreen(handoverViewModelFactory(id)) { navController.popBackStack() }
        }
        composable(Routes.REGISTER) {
            RegisterScreen(registerViewModel) { id -> navController.navigate(Routes.lot(id)) }
        }
        composable(Routes.INSPECT, arguments = listOf(navArgument("id") { type = NavType.IntType })) { entry ->
            val id = entry.arguments!!.getInt("id")
            InspectScreen(inspectViewModelFactory(id)) { navController.popBackStack() }
        }
        composable(Routes.INVENTORY) {
            InventoryScreen(inventoryViewModel) { id -> navController.navigate(Routes.lot(id)) }
        }
        composable(Routes.SEARCH) {
            SearchScreen(searchViewModel) { id -> navController.navigate(Routes.lot(id)) }
        }
        composable(Routes.NOTIFICATIONS) {
            NotificationsScreen(notificationsViewModel) { id -> navController.navigate(Routes.lot(id)) }
        }
        composable(Routes.REGULATOR) {
            RegulatorScreen(regulatorViewModel) { id -> navController.navigate(Routes.lot(id)) }
        }
        composable(Routes.TRACE_SCAN) {
            TraceScanScreen { id -> navController.navigate(Routes.traceResult(id)) }
        }
        composable(Routes.TRACE_RESULT, arguments = listOf(navArgument("id") { type = NavType.IntType })) { entry ->
            TraceResultScreen(traceViewModel, entry.arguments!!.getInt("id"))
        }
        composable(Routes.LABEL, arguments = listOf(navArgument("id") { type = NavType.IntType })) { entry ->
            LabelScreen(labelViewModelFactory(entry.arguments!!.getInt("id")), entry.arguments!!.getInt("id"))
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(settingsViewModel)
        }
    }
}
```

- [ ] **Step 3: Write localization resources for every user-facing string introduced**

`terravane/android/app/src/main/res/values/strings.xml`:
```xml
<resources>
    <string name="app_name">Terravane</string>
    <string name="sign_in_title">Choose your organisation</string>
    <string name="dashboard_pending_signature">Pending your signature</string>
    <string name="dashboard_holdings">Your holdings</string>
    <string name="register_title">Register produce</string>
    <string name="inspect_title">Inspect produce</string>
    <string name="handover_propose">Propose handover</string>
    <string name="handover_accept">Accept pending transfer</string>
    <string name="handover_cancel">Cancel pending transfer</string>
    <string name="settings_base_url">API base URL</string>
    <string name="trace_scan_title">Scan a pack QR code</string>
</resources>
```

`terravane/android/app/src/main/res/values-hi/strings.xml`:
```xml
<resources>
    <string name="app_name">टेराव्हेन</string>
    <string name="sign_in_title">अपना संगठन चुनें</string>
    <string name="dashboard_pending_signature">आपके हस्ताक्षर की प्रतीक्षा में</string>
    <string name="dashboard_holdings">आपकी सूची</string>
    <string name="register_title">उपज पंजीकृत करें</string>
    <string name="inspect_title">उपज का निरीक्षण करें</string>
    <string name="handover_propose">हस्तांतरण प्रस्तावित करें</string>
    <string name="handover_accept">लंबित हस्तांतरण स्वीकार करें</string>
    <string name="handover_cancel">लंबित हस्तांतरण रद्द करें</string>
    <string name="settings_base_url">एपीआई बेस यूआरएल</string>
    <string name="trace_scan_title">पैक क्यूआर कोड स्कैन करें</string>
</resources>
```

Note: the screen composables in Tasks 3-14 use inline `Text("...")` for
speed of drafting; as a follow-up within this task, replace each with
`stringResource(R.string.<key>)` calls against the keys above so the
Hindi resource set actually takes effect. This is a mechanical find/replace
across the screen files, verified visually in Step 5.

- [ ] **Step 4: Run the full unit test suite**

Run: `cd terravane/android && ./gradlew :app:testDebugUnitTest`
Expected: PASS — all ViewModel tests from Tasks 1-14 green.

- [ ] **Step 5: Build the debug APK and manually verify navigation**

Run: `cd terravane/android && ./gradlew :app:assembleDebug`
Expected: BUILD SUCCESSFUL. Install on an emulator or device
(`adb install -r app/build/outputs/apk/debug/app-debug.apk`), set the
API base URL in Settings, sign in, and walk: Dashboard -> Register ->
Lot dossier -> Handover propose -> Notifications -> Inventory -> Search
-> Regulator -> Trace scan (point at a `/api/qr/:id` SVG rendered on
another screen or printed) -> Label. Confirm every screen loads real
data from the configured backend and errors surface the server's
`error` string, not a stack trace.

- [ ] **Step 6: Commit**

```bash
git add terravane/android
git commit -m "Wire all ViewModels into MainActivity, complete NavGraph, add localization"
```

---

## Self-Review Notes

- **Spec coverage:** every screen in the spec's table (Sign-in, Dashboard,
  Lot dossier w/ 6 tabs, Register, Inspect, Handover, Inventory, Search,
  Notifications, Regulator, Consumer trace, Label) has a task. Settings
  (configurable base URL) has Task 3. Localization has Task 15. Stack
  choices (Retrofit, Compose, CameraX/ML Kit, DataStore, Coil, MVVM) all
  appear in Task 1/2. No spec section is without a task.
- **Placeholder scan:** no TBD/TODO; the one explicitly deferred item
  (swapping inline `Text("...")` for `stringResource` calls) is scoped
  concretely as a mechanical step inside Task 15, not left open-ended.
- **Type consistency:** `TerravaneRepository` method names/signatures
  introduced in Task 2 (`batches(q, stage, flag)`, `batch(id)`,
  `lineage(id)`, `notifications(as)`, `trace(id)`, `harvest`, `transfer`,
  `accept`, `cancel`, `inspect`, `recall`) are used identically by every
  consuming ViewModel in Tasks 4-14. `Routes` helpers added incrementally
  in Tasks 1, 6, 7, 9, 13, 14 are all present in Task 15's final
  `NavGraph` rewrite.
