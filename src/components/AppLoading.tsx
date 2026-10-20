type Props = {
  theme: 'dark' | 'light'
}

export default function AppLoading({ theme }: Props) {
  return (
    <div className="appLoading">
      <div className="loadingShell" aria-label="در حال بارگذاری بورسینو">
        <div className="loadingLogoWrap">
          <span className="loadingRing" />
          <img
            src={theme === 'light' ? '/src/assets/logo-dark.svg' : '/src/assets/logo-bright.svg'}
            alt="بورسینو"
            className="loadingLogo"
          />
        </div>
        <div className="loadingBrand">بورسینو</div>
        <div className="loadingText">در حال آماده‌سازی محیط معامله</div>
        <div className="loadingDots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  )
}
