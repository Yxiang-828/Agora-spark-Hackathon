import React, {useEffect} from 'react';

const CSS = `
@media screen and (min-width: 769px) and (hover: hover) and (pointer: fine) {
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer {
    --overrideLhsWidth: var(--agora-lhs-rail-width, 56px);
    width: var(--agora-lhs-rail-width, 56px) !important;
    min-width: var(--agora-lhs-rail-width, 56px) !important;
    max-width: var(--agora-lhs-rail-width, 56px) !important;
    overflow-x: hidden;
    justify-self: start;
    transition:
      width 220ms cubic-bezier(.23,1,.32,1),
      min-width 220ms cubic-bezier(.23,1,.32,1),
      max-width 220ms cubic-bezier(.23,1,.32,1),
      box-shadow 180ms ease;
    will-change: width;
  }

  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:hover,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:focus-within {
    --overrideLhsWidth: 264px;
    width: var(--overrideLhsWidth, 264px) !important;
    min-width: 200px !important;
    max-width: 304px !important;
    box-shadow: 10px 0 24px rgba(0,0,0,.18);
  }

  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .sidebarHeaderContainer {
    justify-content: center;
    padding: 0 4px;
  }

  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .SidebarChannelLinkLabel_wrapper,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .SidebarChannelLinkLabel,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .sidebar-item__name,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .SidebarChannelGroupHeader_text,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .SidebarCategory_newLabel,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .SidebarHeader .header__info,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .SidebarChannelNavigator,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) #sidebarTeamMenuButton > span:not(.Avatar) {
    display: none;
  }

  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .SidebarChannelNavigator__addChannelsCtaLhsButton,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) #addChannelsCta {
    font-size: 0;
    line-height: 0;
    justify-content: center;
    padding-left: 0;
    padding-right: 0;
  }

  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .SidebarChannelNavigator__addChannelsCtaLhsButton .icon,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) #addChannelsCta .icon-plus-box {
    font-size: 18px;
    line-height: 1;
  }

  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .SidebarLink,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .SidebarChannel,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .SidebarChannelGroupHeader_groupButton {
    justify-content: center;
    padding-left: 0;
    padding-right: 0;
  }

  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .SidebarChannel .SidebarLink > i,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) .DirectChannel__profile-picture {
    margin-left: 0;
    margin-right: 0;
  }

  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:not(:hover):not(:focus-within) #browseOrAddChannelMenuButton {
    margin: 0 auto;
  }
}

body.agora-lhs-hover-enabled #channel_view {
  min-width: 0;
  width: 100%;
}

@media screen and (min-width: 1201px) and (hover: hover) and (pointer: fine) {
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:hover,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:focus-within {
    max-width: 304px !important;
  }
}

@media screen and (min-width: 1681px) and (hover: hover) and (pointer: fine) {
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:hover,
  body.agora-lhs-hover-enabled:not(.layout-changing) #SidebarContainer:focus-within {
    max-width: 440px !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  body.agora-lhs-hover-enabled #SidebarContainer {
    transition: none !important;
  }
}
`;

const SidebarHoverController = () => {
    useEffect(() => {
        document.body.classList.add('agora-lhs-hover-enabled');
        return () => {
            document.body.classList.remove('agora-lhs-hover-enabled');
        };
    }, []);

    return <style>{CSS}</style>;
};

export default SidebarHoverController;
