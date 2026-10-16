plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.dependency.management)
    alias(libs.plugins.ktlint)
}

group = "com.stickerbank"
version = "0.0.1"

val appVersion = (findProperty("appVersion") as String?) ?: "dev"

repositories {
    mavenCentral()
}

kotlin {
    jvmToolchain(25)
    compilerOptions {
        freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
    }
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-data-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation("org.flywaydb:flyway-mysql")
    implementation("tools.jackson.module:jackson-module-kotlin")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("org.springframework.security:spring-security-crypto")
    implementation(libs.springdoc.api)
    runtimeOnly("com.mysql:mysql-connector-j")

    testAndDevelopmentOnly("org.springframework.boot:spring-boot-devtools")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.boot:spring-boot-starter-data-jdbc-test")
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.testcontainers:testcontainers-mysql")
    testImplementation(libs.mockk)
    testImplementation(libs.springmockk)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.bootJar {
    archiveFileName.set("sticker-bank.jar")
}

springBoot {
    buildInfo {
        properties {
            version.set(appVersion)
        }
    }
}

tasks.processResources {
    from("../artwork/catalog.json") {
        into("artwork")
    }
}

tasks.test {
    useJUnitPlatform()
}
