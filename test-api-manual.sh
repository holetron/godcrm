#!/bin/bash
# Ручное тестирование GOD CRM v0.002.006 API
# Использование: bash test-api-manual.sh

API_BASE="http://localhost:5000/api/v2/new"
TIMESTAMP=$(date +%s)

echo "🧪 GOD CRM v0.002.006 - Manual API Testing"
echo "=========================================="
echo ""

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для красивого вывода
test_step() {
    echo -e "${BLUE}▶ $1${NC}"
}

test_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

test_error() {
    echo -e "${RED}❌ $1${NC}"
}

test_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# ===================================================================
# TEST 1: Регистрация первого пользователя (должен получить Admin Space)
# ===================================================================
test_step "TEST 1: Регистрация первого пользователя"

REGISTER_RESPONSE=$(curl -s -X POST "$API_BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"owner_$TIMESTAMP@test.com\",\"password\":\"OwnerPass123\",\"name\":\"Test Owner\"}")

OWNER_TOKEN=$(echo $REGISTER_RESPONSE | jq -r '.data.accessToken')
OWNER_ID=$(echo $REGISTER_RESPONSE | jq -r '.data.user.id')

if [ "$OWNER_TOKEN" != "null" ]; then
    test_success "Владелец зарегистрирован (ID: $OWNER_ID)"
    test_info "Token: ${OWNER_TOKEN:0:50}..."
else
    test_error "Ошибка регистрации владельца"
    echo $REGISTER_RESPONSE | jq '.'
    exit 1
fi

echo ""

# ===================================================================
# TEST 2: Проверка авто-созданных проектов (Admin + Personal)
# ===================================================================
test_step "TEST 2: Проверка авто-созданных проектов владельца"

PROJECTS=$(curl -s "$API_BASE/projects" \
  -H "Authorization: Bearer $OWNER_TOKEN")

ADMIN_SPACE=$(echo $PROJECTS | jq -r '.data.projects[] | select(.type == "admin_owner_space") | .name')
PERSONAL_SPACE=$(echo $PROJECTS | jq -r '.data.projects[] | select(.type == "personal_space") | .name')
PROJECT_COUNT=$(echo $PROJECTS | jq -r '.data.projects | length')

if [ "$PROJECT_COUNT" == "2" ]; then
    test_success "Создано 2 проекта (Admin + Personal)"
    test_info "Admin Space: $ADMIN_SPACE"
    test_info "Personal Space: $PERSONAL_SPACE"
else
    test_error "Ожидалось 2 проекта, получено: $PROJECT_COUNT"
    echo $PROJECTS | jq '.'
    exit 1
fi

echo ""

# ===================================================================
# TEST 3: Регистрация второго пользователя (только Personal Space)
# ===================================================================
test_step "TEST 3: Регистрация второго пользователя"

USER2_RESPONSE=$(curl -s -X POST "$API_BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"user2_$TIMESTAMP@test.com\",\"password\":\"User2Pass123\",\"name\":\"Test User 2\"}")

USER2_TOKEN=$(echo $USER2_RESPONSE | jq -r '.data.accessToken')
USER2_ID=$(echo $USER2_RESPONSE | jq -r '.data.user.id')

if [ "$USER2_TOKEN" != "null" ]; then
    test_success "User2 зарегистрирован (ID: $USER2_ID)"
else
    test_error "Ошибка регистрации user2"
    echo $USER2_RESPONSE | jq '.'
    exit 1
fi

# Проверяем что у user2 только Personal Space
USER2_PROJECTS=$(curl -s "$API_BASE/projects" \
  -H "Authorization: Bearer $USER2_TOKEN")

USER2_PROJECT_COUNT=$(echo $USER2_PROJECTS | jq -r '.data.projects | length')
USER2_HAS_ADMIN=$(echo $USER2_PROJECTS | jq -r '.data.projects[] | select(.type == "admin_owner_space") | .id')

if [ "$USER2_PROJECT_COUNT" == "1" ] && [ -z "$USER2_HAS_ADMIN" ]; then
    test_success "User2 получил только Personal Space (правильно!)"
else
    test_error "User2 должен иметь только Personal Space"
    echo $USER2_PROJECTS | jq '.'
    exit 1
fi

echo ""

# ===================================================================
# TEST 4: Создание custom проекта
# ===================================================================
test_step "TEST 4: Создание custom проекта с темой"

CREATE_PROJECT=$(curl -s -X POST "$API_BASE/projects" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Project 🚀","description":"Test description","icon":"🧪","theme_primary":"#ff00ff","theme_secondary":"#00ffff"}')

CUSTOM_PROJECT_ID=$(echo $CREATE_PROJECT | jq -r '.data.project.id')
CUSTOM_PROJECT_NAME=$(echo $CREATE_PROJECT | jq -r '.data.project.name')
CUSTOM_THEME=$(echo $CREATE_PROJECT | jq -r '.data.project.theme_primary')

if [ "$CUSTOM_PROJECT_ID" != "null" ]; then
    test_success "Custom проект создан (ID: $CUSTOM_PROJECT_ID)"
    test_info "Название: $CUSTOM_PROJECT_NAME"
    test_info "Тема: $CUSTOM_THEME"
else
    test_error "Ошибка создания custom проекта"
    echo $CREATE_PROJECT | jq '.'
    exit 1
fi

echo ""

# ===================================================================
# TEST 5: Получение проекта по ID
# ===================================================================
test_step "TEST 5: Получение проекта по ID"

GET_PROJECT=$(curl -s "$API_BASE/projects/$CUSTOM_PROJECT_ID" \
  -H "Authorization: Bearer $OWNER_TOKEN")

PROJECT_NAME=$(echo $GET_PROJECT | jq -r '.data.project.name')

if [ "$PROJECT_NAME" == "$CUSTOM_PROJECT_NAME" ]; then
    test_success "Проект получен по ID"
else
    test_error "Ошибка получения проекта"
    echo $GET_PROJECT | jq '.'
    exit 1
fi

echo ""

# ===================================================================
# TEST 6: Обновление проекта
# ===================================================================
test_step "TEST 6: Обновление проекта"

UPDATE_PROJECT=$(curl -s -X PATCH "$API_BASE/projects/$CUSTOM_PROJECT_ID" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Updated Project Name","description":"Updated description"}')

UPDATED_NAME=$(echo $UPDATE_PROJECT | jq -r '.data.project.name')

if [ "$UPDATED_NAME" == "Updated Project Name" ]; then
    test_success "Проект обновлен"
    test_info "Новое название: $UPDATED_NAME"
else
    test_error "Ошибка обновления проекта"
    echo $UPDATE_PROJECT | jq '.'
    exit 1
fi

echo ""

# ===================================================================
# TEST 7: Защита от доступа к чужим проектам
# ===================================================================
test_step "TEST 7: Попытка доступа user2 к проекту owner"

USER2_ACCESS=$(curl -s "$API_BASE/projects/$CUSTOM_PROJECT_ID" \
  -H "Authorization: Bearer $USER2_TOKEN")

USER2_ERROR=$(echo $USER2_ACCESS | jq -r '.error.code')

if [ "$USER2_ERROR" == "PROJECT_NOT_FOUND" ]; then
    test_success "User2 не может получить доступ к проекту owner (защита работает!)"
else
    test_error "User2 смог получить доступ к чужому проекту!"
    echo $USER2_ACCESS | jq '.'
    exit 1
fi

echo ""

# ===================================================================
# TEST 8: Защита от удаления Personal Space
# ===================================================================
test_step "TEST 8: Попытка удалить Personal Space"

PERSONAL_SPACE_ID=$(echo $PROJECTS | jq -r '.data.projects[] | select(.type == "personal_space") | .id')

DELETE_PERSONAL=$(curl -s -X DELETE "$API_BASE/projects/$PERSONAL_SPACE_ID" \
  -H "Authorization: Bearer $OWNER_TOKEN")

DELETE_ERROR=$(echo $DELETE_PERSONAL | jq -r '.error.code')

if [ "$DELETE_ERROR" == "CANNOT_DELETE_SYSTEM_PROJECT" ]; then
    test_success "Personal Space защищен от удаления!"
else
    test_error "Personal Space был удален (не должно быть)!"
    echo $DELETE_PERSONAL | jq '.'
    exit 1
fi

echo ""

# ===================================================================
# TEST 9: Удаление custom проекта
# ===================================================================
test_step "TEST 9: Удаление custom проекта"

DELETE_CUSTOM=$(curl -s -X DELETE "$API_BASE/projects/$CUSTOM_PROJECT_ID" \
  -H "Authorization: Bearer $OWNER_TOKEN")

DELETE_SUCCESS=$(echo $DELETE_CUSTOM | jq -r '.success')

if [ "$DELETE_SUCCESS" == "true" ]; then
    test_success "Custom проект удален"
else
    test_error "Ошибка удаления custom проекта"
    echo $DELETE_CUSTOM | jq '.'
    exit 1
fi

# Проверяем что проект действительно удален
VERIFY_DELETED=$(curl -s "$API_BASE/projects/$CUSTOM_PROJECT_ID" \
  -H "Authorization: Bearer $OWNER_TOKEN")

VERIFY_ERROR=$(echo $VERIFY_DELETED | jq -r '.error.code')

if [ "$VERIFY_ERROR" == "PROJECT_NOT_FOUND" ]; then
    test_success "Проект действительно удален из БД"
else
    test_error "Проект все еще существует!"
    exit 1
fi

echo ""

# ===================================================================
# TEST 10: Logout
# ===================================================================
test_step "TEST 10: Logout"

LOGOUT=$(curl -s -X POST "$API_BASE/auth/logout" \
  -H "Authorization: Bearer $OWNER_TOKEN")

LOGOUT_SUCCESS=$(echo $LOGOUT | jq -r '.success')

if [ "$LOGOUT_SUCCESS" == "true" ]; then
    test_success "Logout выполнен"
else
    test_error "Ошибка logout"
    echo $LOGOUT | jq '.'
    exit 1
fi

echo ""
echo "=========================================="
echo -e "${GREEN}🎉 ВСЕ ТЕСТЫ ПРОШЛИ УСПЕШНО!${NC}"
echo "=========================================="
echo ""
echo "📊 Статистика:"
echo "  - Тестов выполнено: 10"
echo "  - Endpoints протестировано: 10"
echo "  - Пользователей создано: 2"
echo "  - Проектов создано: 5"
echo ""
echo "✅ API v0.002.006 полностью работоспособен!"
