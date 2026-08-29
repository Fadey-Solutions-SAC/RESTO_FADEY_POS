// Scaffold mínimo. Abrir en Android Studio y completar Gradle del proyecto.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.restofadey.dniesigner"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.restofadey.dniesigner"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.3.0-scaffold"
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
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
}
